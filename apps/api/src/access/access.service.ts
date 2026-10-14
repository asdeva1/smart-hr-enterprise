import { Inject, Injectable } from '@nestjs/common';
import { generateToken, hashToken, normalizeEmail } from '@smart-hr/auth';
import {
  isUniqueViolation,
  withContext,
  type DatabaseClient,
  type Prisma,
  type ScopeType,
  type TenantTransaction,
} from '@smart-hr/database';
import {
  AppError,
  defined,
  ForbiddenError,
  isPermission,
  NotFoundError,
  PERMISSION_MODULES,
  PERMISSIONS,
  type Permission,
  type ScopeRef,
} from '@smart-hr/shared';
import {
  auditQuerySchema,
  createRoleSchema,
  inviteMemberSchema,
  memberListQuerySchema,
  roleAssignmentSchema,
  updateMemberSchema,
  updateRoleSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { InvitationService } from '../identity/invitation.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import type { ApiEnv } from '../config/env.js';
import { API_ENV, DATABASE } from '../infra/tokens.js';
import { MailService } from '../notifications/mail.service.js';
import { RbacService } from '../rbac/rbac.service.js';

type AssignmentInput = z.output<typeof roleAssignmentSchema>;

const ROLE_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  isSystem: true,
  updatedAt: true,
  permissions: { select: { permission: true } },
  _count: { select: { assignments: true } },
} as const;

function roleView(role: Prisma.RoleGetPayload<{ select: typeof ROLE_SELECT }>) {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    updatedAt: role.updatedAt,
    permissions: role.permissions.map((p) => p.permission).sort(),
    assignmentCount: role._count.assignments,
  };
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return /^[a-z]/.test(base) ? base : `role_${base}`;
}

/**
 * Members, invitations, roles and role assignments.
 *
 * Escalation rules (owners are exempt — they already hold everything):
 * - assigning a role at a scope needs access.manage covering that scope AND every permission in the role there;
 * - nobody changes their own assignments;
 * - custom roles may only contain permissions the editor holds tenant-wide; system roles are fixed;
 * - only owners grant or remove ownership, and the last active owner cannot be removed.
 */
@Injectable()
export class AccessService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly entitlements: EntitlementsService,
    private readonly invitations: InvitationService,
  ) {}

  private run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, work);
  }

  private requireTenantWide(tenant: TenantContext, code: Permission): void {
    if (!tenant.permissions.allowsTenantWide(code)) throw new ForbiddenError();
  }

  private scopeIdFor(tenant: TenantContext, input: AssignmentInput): string {
    return input.scopeType === 'TENANT' ? tenant.id : input.scopeId!;
  }

  /** Checks the caller may grant `roleId` at the scope, and returns the role. */
  private async checkGrant(
    tx: TenantTransaction,
    tenant: TenantContext,
    input: AssignmentInput,
  ): Promise<{ role: { id: string; name: string }; scopeId: string; scopes: ScopeRef[] }> {
    const role = await tx.role.findUnique({
      where: { id: input.roleId },
      select: { id: true, name: true, permissions: { select: { permission: true } } },
    });
    if (!role) throw new NotFoundError('Role');
    const scopeId = this.scopeIdFor(tenant, input);
    const scopes = await this.rbac.scopesOf(tx, tenant.id, { type: input.scopeType, id: scopeId });
    if (!tenant.permissions.allows('access.manage', scopes)) throw new ForbiddenError();
    const exceeds = role.permissions
      .map((p) => p.permission)
      .filter((code) => !isPermission(code) || !tenant.permissions.allows(code, scopes));
    if (exceeds.length > 0) {
      throw new AppError(
        'ROLE_EXCEEDS_YOUR_ACCESS',
        'You can only assign roles whose permissions you hold yourself at that scope',
        403,
      );
    }
    return { role: { id: role.id, name: role.name }, scopeId, scopes };
  }

  // ---- Members ------------------------------------------------------------------------------

  private async memberRows(
    tx: TenantTransaction,
    tenant: TenantContext,
    where: Prisma.TenantMembershipWhereInput,
    paging?: { skip: number; take: number },
  ) {
    const rows = await tx.tenantMembership.findMany({
      where,
      orderBy: { user: { displayName: 'asc' } },
      ...(paging ?? {}),
      select: {
        id: true,
        status: true,
        isTenantAdmin: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            lastLoginAt: true,
            mfaEnabledAt: true,
            passwordHash: true,
          },
        },
        assignments: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, scopeType: true, scopeId: true, role: { select: { id: true, name: true } } },
        },
      },
    });
    const names = await this.scopeNames(
      tx,
      tenant,
      rows.flatMap((r) => r.assignments.map((a) => ({ type: a.scopeType, id: a.scopeId }))),
    );
    return rows.map((r) => ({
      membershipId: r.id,
      userId: r.user.id,
      email: r.user.email,
      displayName: r.user.displayName,
      status: r.status,
      isTenantAdmin: r.isTenantAdmin,
      mfaEnabled: r.user.mfaEnabledAt !== null,
      lastLoginAt: r.user.lastLoginAt,
      invitationPending: r.user.passwordHash === null,
      joinedAt: r.createdAt,
      assignments: r.assignments.map((a) => ({
        id: a.id,
        roleId: a.role.id,
        roleName: a.role.name,
        scopeType: a.scopeType,
        scopeId: a.scopeId,
        scopeName: names.get(`${a.scopeType}:${a.scopeId}`) ?? null,
      })),
    }));
  }

  async listMembers(tenant: TenantContext, auth: AuthContext, query: z.output<typeof memberListQuerySchema>) {
    return this.run(tenant, auth, async (tx) => {
      const where: Prisma.TenantMembershipWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
              user: {
                OR: [
                  { email: { contains: query.search, mode: 'insensitive' } },
                  { displayName: { contains: query.search, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      };
      const total = await tx.tenantMembership.count({ where });
      const items = await this.memberRows(tx, tenant, where, {
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      return { total, page: query.page, pageSize: query.pageSize, items };
    });
  }

  async getMember(tenant: TenantContext, auth: AuthContext, membershipId: string) {
    return this.run(tenant, auth, async (tx) => {
      const [member] = await this.memberRows(tx, tenant, { id: membershipId });
      if (!member) throw new NotFoundError('Member');
      return member;
    });
  }

  private async scopeNames(tx: TenantTransaction, tenant: TenantContext, scopes: ScopeRef[]) {
    const ids = (type: ScopeType) => [...new Set(scopes.filter((s) => s.type === type).map((s) => s.id))];
    // Sequential: queries in one transaction share a connection.
    const companies = await tx.company.findMany({
      where: { id: { in: ids('COMPANY') } },
      select: { id: true, name: true },
    });
    const branches = await tx.branch.findMany({
      where: { id: { in: ids('BRANCH') } },
      select: { id: true, name: true },
    });
    const departments = await tx.department.findMany({
      where: { id: { in: ids('DEPARTMENT') } },
      select: { id: true, name: true },
    });
    const names = new Map<string, string>([[`TENANT:${tenant.id}`, 'Whole organisation']]);
    for (const c of companies) names.set(`COMPANY:${c.id}`, c.name);
    for (const b of branches) names.set(`BRANCH:${b.id}`, b.name);
    for (const d of departments) names.set(`DEPARTMENT:${d.id}`, d.name);
    return names;
  }

  async invite(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof inviteMemberSchema>,
    meta: RequestMeta,
  ): Promise<{ membershipId: string }> {
    // The same role at the same scope twice is one assignment.
    const seen = new Set<string>();
    input = {
      ...input,
      assignments: input.assignments.filter((a) => {
        const key = `${a.roleId}:${a.scopeType}:${this.scopeIdFor(tenant, a)}`;
        return seen.has(key) ? false : (seen.add(key), true);
      }),
    };
    if (input.assignments.length === 0) this.requireTenantWide(tenant, 'access.manage');
    const email = normalizeEmail(input.email);
    const tenantName = await this.run(tenant, auth, async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id: tenant.id }, select: { name: true } });
      return t!.name;
    });

    // Global identity first (not tenant data): reuse an existing account, or create one without a password.
    const existing = await this.db.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true },
    });
    const user =
      existing ??
      (await this.db.user.create({
        data: { email, displayName: input.displayName },
        select: { id: true, passwordHash: true },
      }));

    const membership = await this.run(tenant, auth, async (tx) => {
      const grants = [];
      for (const a of input.assignments) grants.push(await this.checkGrant(tx, tenant, a));
      await this.entitlements.assertWithinLimit(tx, 'users.max');
      let created;
      try {
        created = await tx.tenantMembership.create({
          data: { tenantId: tenant.id, userId: user.id },
          select: { id: true },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError('ALREADY_MEMBER', 'This person is already a member of the organisation', 409, [
            { path: 'email', message: 'Already a member' },
          ]);
        }
        throw error;
      }
      for (const [i, g] of grants.entries()) {
        await tx.roleAssignment.create({
          data: {
            tenantId: tenant.id,
            membershipId: created.id,
            roleId: g.role.id,
            scopeType: input.assignments[i]!.scopeType,
            scopeId: g.scopeId,
            createdByUserId: auth.user.id,
          },
        });
      }
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'access.member.invite',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'membership',
          targetId: created.id,
          metadata: {
            newAccount: !existing,
            roles: grants.map((g, i) => ({
              roleId: g.role.id,
              scopeType: input.assignments[i]!.scopeType,
              scopeId: g.scopeId,
            })),
          },
        },
        meta,
      );
      return created;
    });

    if (user.passwordHash === null) {
      await this.invitations.send(user.id, email, input.displayName, tenantName, auth.user.displayName);
    } else {
      await this.mail.send({
        to: email,
        category: 'membership_added',
        subject: `You’ve been added to ${tenantName} on Smart HR`,
        text: [
          `Hello ${input.displayName},`,
          '',
          `${auth.user.displayName} added you to ${tenantName} on Smart HR.`,
          `Sign in with your existing account: ${new URL('/login', this.env.APP_PUBLIC_URL).toString()}`,
        ].join('\n'),
      });
    }
    return { membershipId: membership.id };
  }

  async resendInvitation(tenant: TenantContext, auth: AuthContext, membershipId: string, meta: RequestMeta) {
    this.requireTenantWide(tenant, 'access.manage');
    const target = await this.run(tenant, auth, async (tx) => {
      const m = await tx.tenantMembership.findUnique({
        where: { id: membershipId },
        select: {
          id: true,
          tenant: { select: { name: true } },
          user: { select: { id: true, email: true, displayName: true, passwordHash: true } },
        },
      });
      if (!m) throw new NotFoundError('Member');
      if (m.user.passwordHash !== null) {
        throw new AppError('ALREADY_ACTIVE', 'This person has already set up their account', 409);
      }
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'access.member.invite_resent',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'membership',
          targetId: m.id,
        },
        meta,
      );
      return m;
    });
    await this.invitations.send(
      target.user.id,
      target.user.email,
      target.user.displayName,
      target.tenant.name,
      auth.user.displayName,
    );
  }

  async updateMember(
    tenant: TenantContext,
    auth: AuthContext,
    membershipId: string,
    input: z.output<typeof updateMemberSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const member = await tx.tenantMembership.findUnique({
        where: { id: membershipId },
        select: { id: true, userId: true, status: true, isTenantAdmin: true },
      });
      if (!member) throw new NotFoundError('Member');
      const isSelf = member.userId === auth.user.id;

      if (input.isTenantAdmin !== undefined && input.isTenantAdmin !== member.isTenantAdmin) {
        if (!tenant.isTenantAdmin) throw new ForbiddenError('Only organisation owners can change ownership');
      }
      if (input.status !== undefined && input.status !== member.status) {
        this.requireTenantWide(tenant, 'access.manage');
        if (isSelf) throw new AppError('CANNOT_CHANGE_SELF', 'You can’t suspend your own access', 400);
        if (member.isTenantAdmin && !tenant.isTenantAdmin) {
          throw new ForbiddenError('Only organisation owners can suspend an owner');
        }
      }

      if (input.status === 'ACTIVE' && member.status !== 'ACTIVE') {
        await this.entitlements.assertWithinLimit(tx, 'users.max');
      }

      const removesOwner =
        member.isTenantAdmin &&
        member.status === 'ACTIVE' &&
        (input.isTenantAdmin === false || input.status === 'SUSPENDED');
      if (removesOwner) {
        const owners = await tx.tenantMembership.count({ where: { isTenantAdmin: true, status: 'ACTIVE' } });
        if (owners <= 1) {
          throw new AppError('LAST_OWNER', 'An organisation must keep at least one active owner', 409);
        }
      }

      const updated = await tx.tenantMembership.update({
        where: { id: membershipId },
        data: defined(input),
        select: { id: true, status: true, isTenantAdmin: true },
      });
      await this.audit.recordInTransaction(
        tx,
        {
          action:
            input.isTenantAdmin !== undefined && input.isTenantAdmin !== member.isTenantAdmin
              ? input.isTenantAdmin
                ? 'access.owner.grant'
                : 'access.owner.revoke'
              : input.status === 'SUSPENDED'
                ? 'access.member.suspend'
                : 'access.member.update',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'membership',
          targetId: membershipId,
          metadata: { status: updated.status, isTenantAdmin: updated.isTenantAdmin },
        },
        meta,
      );
      return updated;
    });
  }

  async addAssignment(
    tenant: TenantContext,
    auth: AuthContext,
    membershipId: string,
    input: AssignmentInput,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const member = await tx.tenantMembership.findUnique({
        where: { id: membershipId },
        select: { id: true, userId: true },
      });
      if (!member) throw new NotFoundError('Member');
      if (member.userId === auth.user.id && !tenant.isTenantAdmin) {
        throw new AppError('CANNOT_CHANGE_SELF', 'You can’t change your own roles', 403);
      }
      const grant = await this.checkGrant(tx, tenant, input);
      let assignment;
      try {
        assignment = await tx.roleAssignment.create({
          data: {
            tenantId: tenant.id,
            membershipId,
            roleId: grant.role.id,
            scopeType: input.scopeType,
            scopeId: grant.scopeId,
            createdByUserId: auth.user.id,
          },
          select: { id: true, roleId: true, scopeType: true, scopeId: true },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError('ALREADY_ASSIGNED', 'This role is already assigned at that scope', 409);
        }
        throw error;
      }
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'access.role.assign',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'membership',
          targetId: membershipId,
          metadata: { roleId: grant.role.id, scopeType: input.scopeType, scopeId: grant.scopeId },
        },
        meta,
      );
      return assignment;
    });
  }

  async removeAssignment(
    tenant: TenantContext,
    auth: AuthContext,
    membershipId: string,
    assignmentId: string,
    meta: RequestMeta,
  ) {
    await this.run(tenant, auth, async (tx) => {
      const assignment = await tx.roleAssignment.findUnique({
        where: { id: assignmentId },
        select: {
          id: true,
          membershipId: true,
          roleId: true,
          scopeType: true,
          scopeId: true,
          membership: { select: { userId: true } },
        },
      });
      if (!assignment || assignment.membershipId !== membershipId) throw new NotFoundError('Role assignment');
      if (assignment.membership.userId === auth.user.id && !tenant.isTenantAdmin) {
        throw new AppError('CANNOT_CHANGE_SELF', 'You can’t change your own roles', 403);
      }
      const scopes = await this.rbac.scopesOf(tx, tenant.id, {
        type: assignment.scopeType,
        id: assignment.scopeId,
      });
      if (!tenant.permissions.allows('access.manage', scopes)) throw new ForbiddenError();
      await tx.roleAssignment.delete({ where: { id: assignmentId } });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'access.role.unassign',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'membership',
          targetId: membershipId,
          metadata: {
            roleId: assignment.roleId,
            scopeType: assignment.scopeType,
            scopeId: assignment.scopeId,
          },
        },
        meta,
      );
    });
  }

  async sendPasswordReset(tenant: TenantContext, auth: AuthContext, membershipId: string, meta: RequestMeta) {
    this.requireTenantWide(tenant, 'access.manage');
    const target = await this.run(tenant, auth, async (tx) => {
      const m = await tx.tenantMembership.findUnique({
        where: { id: membershipId },
        select: {
          id: true,
          isTenantAdmin: true,
          user: { select: { id: true, email: true, displayName: true, passwordHash: true } },
        },
      });
      if (!m) throw new NotFoundError('Member');
      if (m.isTenantAdmin && !tenant.isTenantAdmin)
        throw new ForbiddenError('Only owners can reset an owner’s password');
      if (m.user.passwordHash === null) {
        throw new AppError(
          'INVITATION_PENDING',
          'This person hasn’t accepted their invitation yet; resend it instead',
          409,
        );
      }
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'access.member.password_reset_sent',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'membership',
          targetId: m.id,
        },
        meta,
      );
      return m.user;
    });
    const token = generateToken();
    await this.db.$transaction([
      this.db.passwordResetToken.updateMany({
        where: { userId: target.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.db.passwordResetToken.create({
        data: {
          userId: target.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + this.env.PASSWORD_RESET_TTL_MINUTES * 60_000),
        },
      }),
    ]);
    const link = new URL('/reset-password', this.env.APP_PUBLIC_URL);
    link.searchParams.set('token', token);
    await this.mail.send({
      to: target.email,
      category: 'password_reset',
      subject: 'Reset your Smart HR password',
      text: [
        `Hello ${target.displayName},`,
        '',
        `${auth.user.displayName}, an administrator of your organisation, sent you a link to choose a new password.`,
        `Open it within ${this.env.PASSWORD_RESET_TTL_MINUTES} minutes:`,
        '',
        link.toString(),
        '',
        'Your current password keeps working until you choose a new one.',
      ].join('\n'),
    });
  }

  // ---- Roles --------------------------------------------------------------------------------

  permissionCatalogue() {
    return Object.entries(PERMISSIONS).map(([code, def]) => ({
      code,
      module: def.module,
      moduleLabel: PERMISSION_MODULES[def.module] ?? def.module,
      label: def.label,
    }));
  }

  async listRoles(tenant: TenantContext, auth: AuthContext) {
    const roles = await this.run(tenant, auth, (tx) =>
      tx.role.findMany({ orderBy: [{ isSystem: 'desc' }, { name: 'asc' }], select: ROLE_SELECT }),
    );
    return roles.map(roleView);
  }

  private validatePermissions(tenant: TenantContext, codes: string[]): Permission[] {
    const unknown = codes.filter((c) => !isPermission(c));
    if (unknown.length > 0) {
      throw new AppError('UNKNOWN_PERMISSION', `Unknown permission: ${unknown.join(', ')}`, 400, [
        { path: 'permissions', message: 'Contains unknown permissions' },
      ]);
    }
    const valid = [...new Set(codes)] as Permission[];
    if (!tenant.isTenantAdmin) {
      const beyond = valid.filter((c) => !tenant.permissions.allowsTenantWide(c));
      if (beyond.length > 0) {
        throw new AppError(
          'ROLE_EXCEEDS_YOUR_ACCESS',
          'A role can only include permissions you hold across the whole organisation',
          403,
        );
      }
    }
    return valid;
  }

  async createRole(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof createRoleSchema>,
    meta: RequestMeta,
  ) {
    this.requireTenantWide(tenant, 'access.manage');
    const permissions = this.validatePermissions(tenant, input.permissions);
    return this.run(tenant, auth, async (tx) => {
      let key = slugify(input.name);
      for (
        let i = 2;
        await tx.role.findUnique({ where: { tenantId_key: { tenantId: tenant.id, key } } });
        i++
      ) {
        key = `${slugify(input.name).slice(0, 36)}_${i}`;
      }
      const role = await tx.role.create({
        data: {
          tenantId: tenant.id,
          key,
          name: input.name,
          description: input.description ?? null,
          permissions: { create: permissions.map((permission) => ({ permission })) },
        },
        select: ROLE_SELECT,
      });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'access.role.create',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'role',
          targetId: role.id,
          metadata: { name: role.name, permissions },
        },
        meta,
      );
      return roleView(role);
    });
  }

  async updateRole(
    tenant: TenantContext,
    auth: AuthContext,
    roleId: string,
    input: z.output<typeof updateRoleSchema>,
    meta: RequestMeta,
  ) {
    this.requireTenantWide(tenant, 'access.manage');
    return this.run(tenant, auth, async (tx) => {
      const role = await tx.role.findUnique({ where: { id: roleId }, select: ROLE_SELECT });
      if (!role) throw new NotFoundError('Role');
      if (role.isSystem)
        throw new AppError('SYSTEM_ROLE', 'Built-in roles can’t be changed; create a new role instead', 409);
      const before = role.permissions.map((p) => p.permission);
      if (!tenant.isTenantAdmin) {
        // Editing a role changes everyone who holds it, so the editor must hold what it already grants too.
        this.validatePermissions(tenant, before);
      }
      const permissions = input.permissions ? this.validatePermissions(tenant, input.permissions) : undefined;
      if (permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId } });
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({ tenantId: tenant.id, roleId, permission })),
        });
      }
      const updated = await tx.role.update({
        where: { id: roleId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
        select: ROLE_SELECT,
      });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'access.role.update',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'role',
          targetId: roleId,
          metadata: {
            added: permissions?.filter((p) => !before.includes(p)) ?? [],
            removed: permissions ? before.filter((p) => !permissions.includes(p as Permission)) : [],
            renamed: input.name !== undefined && input.name !== role.name,
          },
        },
        meta,
      );
      return roleView(updated);
    });
  }

  async deleteRole(tenant: TenantContext, auth: AuthContext, roleId: string, meta: RequestMeta) {
    this.requireTenantWide(tenant, 'access.manage');
    await this.run(tenant, auth, async (tx) => {
      const role = await tx.role.findUnique({ where: { id: roleId }, select: ROLE_SELECT });
      if (!role) throw new NotFoundError('Role');
      if (role.isSystem) throw new AppError('SYSTEM_ROLE', 'Built-in roles can’t be deleted', 409);
      if (role._count.assignments > 0) {
        throw new AppError('ROLE_IN_USE', 'Remove this role from everyone who has it first', 409);
      }
      await tx.role.delete({ where: { id: roleId } });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'access.role.delete',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'role',
          targetId: roleId,
          metadata: { name: role.name },
        },
        meta,
      );
    });
  }

  // ---- Security policy ----------------------------------------------------------------------

  async securityPolicy(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id: tenant.id }, select: { requireMfa: true } });
      return { requireMfa: t!.requireMfa };
    });
  }

  async updateSecurityPolicy(
    tenant: TenantContext,
    auth: AuthContext,
    requireMfa: boolean,
    meta: RequestMeta,
  ) {
    this.requireTenantWide(tenant, 'security.manage');
    if (requireMfa && !auth.user.mfaEnabledAt) {
      throw new AppError(
        'ENABLE_MFA_FIRST',
        'Turn on two-step verification for your own account before requiring it for everyone',
        409,
      );
    }
    return this.run(tenant, auth, async (tx) => {
      const updated = await tx.tenant.update({
        where: { id: tenant.id },
        data: { requireMfa },
        select: { requireMfa: true },
      });
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'security.policy.update',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'tenant',
          targetId: tenant.id,
          metadata: { requireMfa },
        },
        meta,
      );
      return updated;
    });
  }

  // ---- Audit log ----------------------------------------------------------------------------

  async auditLog(tenant: TenantContext, auth: AuthContext, query: z.output<typeof auditQuerySchema>) {
    this.requireTenantWide(tenant, 'audit.view');
    return this.run(tenant, auth, async (tx) => {
      const cursor = query.before
        ? await tx.auditEvent.findUnique({
            where: { id: query.before },
            select: { occurredAt: true, id: true },
          })
        : null;
      const events = await tx.auditEvent.findMany({
        where: {
          tenantId: tenant.id,
          ...(query.action ? { action: { startsWith: query.action } } : {}),
          ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
          ...(query.outcome ? { outcome: query.outcome } : {}),
          ...(query.from || query.to
            ? {
                occurredAt: {
                  ...(query.from ? { gte: new Date(query.from) } : {}),
                  ...(query.to ? { lte: new Date(query.to) } : {}),
                },
              }
            : {}),
          ...(cursor
            ? {
                OR: [
                  { occurredAt: { lt: cursor.occurredAt } },
                  { occurredAt: cursor.occurredAt, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        select: {
          id: true,
          occurredAt: true,
          action: true,
          outcome: true,
          actorUserId: true,
          targetType: true,
          targetId: true,
          ipAddress: true,
          metadata: true,
        },
      });
      const page = events.slice(0, query.limit);
      const actorIds = [...new Set(page.map((e) => e.actorUserId).filter((id): id is string => !!id))];
      // Only names of people who are members of this tenant are shown.
      const actors = await tx.tenantMembership.findMany({
        where: { userId: { in: actorIds } },
        select: { userId: true, user: { select: { displayName: true, email: true } } },
      });
      const byId = new Map(actors.map((a) => [a.userId, a.user]));
      return {
        items: page.map((e) => ({
          ...e,
          actor: e.actorUserId
            ? (byId.get(e.actorUserId) ?? { displayName: 'Former member', email: null })
            : null,
        })),
        nextBefore: events.length > query.limit ? page.at(-1)!.id : null,
      };
    });
  }
}
