import { Inject, Injectable } from '@nestjs/common';
import { normalizeEmail } from '@smart-hr/auth';
import {
  isUniqueViolation,
  withContext,
  type DatabaseClient,
  type EmployeeEventKind,
  type Prisma,
  type TenantTransaction,
} from '@smart-hr/database';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  type Permission,
  type PermissionSet,
} from '@smart-hr/shared';
import type {
  createEmployeeSchema,
  emergencyContactSchema,
  employeeLifecycleSchema,
  employeeListQuerySchema,
  updateEmployeeSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { DATABASE } from '../infra/tokens.js';
import { OrgIndex } from './org-index.js';

type CreateEmployee = z.output<typeof createEmployeeSchema>;
type UpdateEmployee = z.output<typeof updateEmployeeSchema>;
export type Lifecycle = z.output<typeof employeeLifecycleSchema>;

/** A lifecycle change worked out and checked, ready to write. */
export interface PreparedChange {
  kind: EmployeeEventKind;
  effective: Date;
  data: Prisma.EmployeeUncheckedUpdateManyInput;
  changes: Record<string, { from: unknown; to: unknown }>;
  /** An exit ends the leaver's sign-in to this organisation. */
  suspendMembershipId: string | null;
}
type ListQuery = z.output<typeof employeeListQuerySchema>;
type ContactInput = z.output<typeof emergencyContactSchema>;

/** Lookup columns and the reference list each must come from. */
export const LOOKUP_LISTS = {
  designationId: 'designation',
  gradeId: 'grade',
  employmentTypeId: 'employment_type',
  costCentreId: 'cost_centre',
  exitReasonId: 'exit_reason',
} as const;
type LookupColumn = keyof typeof LOOKUP_LISTS;

const named = { select: { id: true, name: true } } as const;
const coded = { select: { id: true, code: true, name: true } } as const;

export const EMPLOYEE_SELECT = {
  id: true,
  employeeCode: true,
  membershipId: true,
  firstName: true,
  lastName: true,
  preferredName: true,
  workEmail: true,
  personalEmail: true,
  phone: true,
  dateOfBirth: true,
  gender: true,
  companyId: true,
  branchId: true,
  departmentId: true,
  designationId: true,
  gradeId: true,
  employmentTypeId: true,
  costCentreId: true,
  managerId: true,
  dateOfJoining: true,
  probationEndDate: true,
  status: true,
  noticeGivenOn: true,
  lastWorkingDay: true,
  exitReasonId: true,
  exitedOn: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  company: coded,
  branch: coded,
  department: coded,
  designation: named,
  grade: named,
  employmentType: named,
  costCentre: named,
  exitReason: named,
  manager: { select: { id: true, employeeCode: true, firstName: true, lastName: true, preferredName: true } },
  membership: { select: { id: true, status: true, user: { select: { email: true } } } },
  _count: { select: { reports: { where: { status: { not: 'EXITED' } } } } },
} satisfies Prisma.EmployeeSelect;

const LIST_SELECT = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  preferredName: true,
  workEmail: true,
  status: true,
  dateOfJoining: true,
  lastWorkingDay: true,
  managerId: true,
  membershipId: true,
  company: coded,
  branch: coded,
  department: coded,
  designation: named,
  manager: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
} satisfies Prisma.EmployeeSelect;

export type EmployeeRecord = Prisma.EmployeeGetPayload<{ select: typeof EMPLOYEE_SELECT }>;

/** Dates are stored as DATE; the API speaks YYYY-MM-DD. */
export const toDate = (v: string) => new Date(`${v}T00:00:00Z`);
export const toDateOrNull = (v: string | null | undefined) => (v ? toDate(v) : (v as null | undefined));
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function displayName(e: {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
}): string {
  return `${e.preferredName || e.firstName} ${e.lastName}`;
}

export function present(e: EmployeeRecord) {
  return {
    ...e,
    name: displayName(e),
    dateOfBirth: iso(e.dateOfBirth),
    dateOfJoining: iso(e.dateOfJoining),
    probationEndDate: iso(e.probationEndDate),
    noticeGivenOn: iso(e.noticeGivenOn),
    lastWorkingDay: iso(e.lastWorkingDay),
    exitedOn: iso(e.exitedOn),
    manager: e.manager && {
      id: e.manager.id,
      employeeCode: e.manager.employeeCode,
      name: displayName(e.manager),
    },
    signIn: e.membership && { status: e.membership.status, email: e.membership.user.email },
    membership: undefined,
    directReports: e._count.reports,
    _count: undefined,
  };
}

/**
 * Employee records. Visibility follows the member's scopes: someone with employees.view on a branch sees
 * that branch's employees and no others. Corrections are versioned; career events (transfers, promotions,
 * manager changes, notice, exit) go through `lifecycle` and land in the append-only history.
 */
@Injectable()
export class EmployeesService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {
    // Employees count towards the plan's limit while they are employed (notice included).
    entitlements.registerUsage('employees.max', (tx) =>
      tx.employee.count({ where: { status: { not: 'EXITED' } } }),
    );
  }

  run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, work);
  }

  // ---- Reading ----------------------------------------------------------------------------------

  async list(tenant: TenantContext, auth: AuthContext, q: ListQuery) {
    return this.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const visible = org.visibilityFilter(tenant.permissions, 'employees.view');
      const status =
        q.status === 'ALL'
          ? {}
          : q.status === 'CURRENT'
            ? { status: { in: ['ACTIVE' as const, 'ON_NOTICE' as const] } }
            : { status: q.status };
      const terms = (q.search ?? '').split(/\s+/).filter(Boolean).slice(0, 5);
      const where: Prisma.EmployeeWhereInput = {
        AND: [
          ...(visible ? [visible] : []),
          status,
          ...(q.companyId ? [{ companyId: q.companyId }] : []),
          ...(q.branchId ? [{ branchId: q.branchId }] : []),
          ...(q.departmentId ? [{ departmentId: q.departmentId }] : []),
          ...(q.managerId ? [{ managerId: q.managerId }] : []),
          ...terms.map((t) => ({
            OR: [
              { firstName: { contains: t, mode: 'insensitive' as const } },
              { lastName: { contains: t, mode: 'insensitive' as const } },
              { preferredName: { contains: t, mode: 'insensitive' as const } },
              { employeeCode: { contains: t, mode: 'insensitive' as const } },
              { workEmail: { contains: t, mode: 'insensitive' as const } },
            ],
          })),
        ],
      };
      const orderBy: Prisma.EmployeeOrderByWithRelationInput[] =
        q.sort === 'code'
          ? [{ employeeCode: 'asc' }]
          : q.sort === 'joined'
            ? [{ dateOfJoining: 'desc' }, { employeeCode: 'asc' }]
            : [{ firstName: 'asc' }, { lastName: 'asc' }, { employeeCode: 'asc' }];
      const total = await tx.employee.count({ where });
      const rows = await tx.employee.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: LIST_SELECT,
      });
      return {
        total,
        page: q.page,
        pageSize: q.pageSize,
        items: rows.map((e) => ({
          ...e,
          name: displayName(e),
          dateOfJoining: iso(e.dateOfJoining),
          lastWorkingDay: iso(e.lastWorkingDay),
          manager: e.manager && { id: e.manager.id, name: displayName(e.manager) },
        })),
      };
    });
  }

  /** Loads one employee the member may see with `code`, or 404 (never revealing that it exists elsewhere). */
  async load(tx: TenantTransaction, tenant: TenantContext, org: OrgIndex, id: string, code: Permission) {
    const e = await tx.employee.findUnique({ where: { id }, select: EMPLOYEE_SELECT });
    if (!e) throw new NotFoundError('Employee');
    const scopes = org.scopesOf(e);
    if (!tenant.permissions.allows(code, scopes)) {
      if (code !== 'employees.view' && tenant.permissions.allows('employees.view', scopes))
        throw new ForbiddenError();
      throw new NotFoundError('Employee');
    }
    return e;
  }

  async get(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const e = await this.load(tx, tenant, org, id, 'employees.view');
      const scopes = org.scopesOf(e);
      return {
        ...present(e),
        can: {
          manage: tenant.permissions.allows('employees.manage', scopes),
          lifecycle: tenant.permissions.allows('employees.lifecycle', scopes),
          viewSensitive: tenant.permissions.allows('employees.sensitive.view', scopes),
          manageSensitive: tenant.permissions.allows('employees.sensitive.manage', scopes),
          invite: tenant.permissions.hasAnywhere('access.manage'),
        },
      };
    });
  }

  async history(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) => {
      await this.load(tx, tenant, await OrgIndex.load(tx, tenant.id), id, 'employees.view');
      const events = await tx.employeeEvent.findMany({
        where: { employeeId: id },
        orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
      });
      const actorIds = [...new Set(events.map((e) => e.actorUserId).filter((x): x is string => !!x))];
      const actors = actorIds.length
        ? await this.db.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, displayName: true },
          })
        : [];
      const actorName = new Map(actors.map((a) => [a.id, a.displayName]));
      return events.map((e) => ({
        id: e.id,
        kind: e.kind,
        effectiveDate: iso(e.effectiveDate),
        changes: e.changes,
        note: e.note,
        recordedAt: e.createdAt,
        recordedBy: e.actorUserId ? (actorName.get(e.actorUserId) ?? null) : null,
      }));
    });
  }

  /** Current employees the member can see, with their manager, for drawing the organisation chart. */
  async orgChart(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const visible = org.visibilityFilter(tenant.permissions, 'employees.view');
      const rows = await tx.employee.findMany({
        where: { AND: [...(visible ? [visible] : []), { status: { in: ['ACTIVE', 'ON_NOTICE'] } }] },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        take: 5000,
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          managerId: true,
          status: true,
          designation: { select: { name: true } },
          department: { select: { name: true } },
        },
      });
      return rows.map((r) => ({
        id: r.id,
        employeeCode: r.employeeCode,
        name: displayName(r),
        managerId: r.managerId,
        status: r.status,
        designation: r.designation?.name ?? null,
        department: r.department?.name ?? null,
      }));
    });
  }

  // ---- Validation helpers -------------------------------------------------------------------------

  /** Lookups must exist in the right list and be in use; returns display names for history. */
  async checkLookups(
    tx: TenantTransaction,
    values: Partial<Record<LookupColumn, string | null | undefined>>,
  ) {
    const ids = Object.values(values).filter((v): v is string => !!v);
    const found = ids.length
      ? await tx.lookupValue.findMany({
          where: { id: { in: ids } },
          select: { id: true, list: true, name: true, status: true },
        })
      : [];
    const byId = new Map(found.map((f) => [f.id, f]));
    for (const [column, id] of Object.entries(values) as [LookupColumn, string | null | undefined][]) {
      if (!id) continue;
      const v = byId.get(id);
      if (!v || v.list !== LOOKUP_LISTS[column] || v.status !== 'ACTIVE') {
        throw new AppError('VALIDATION_FAILED', 'Choose a value from the list', 400, [
          { path: column, message: 'Choose a value from the list' },
        ]);
      }
    }
    return byId;
  }

  /** The new manager must be a current employee and must not report (directly or not) to this employee. */
  async checkManager(tx: TenantTransaction, employeeId: string | null, managerId: string | null | undefined) {
    if (!managerId) return null;
    const manager = await tx.employee.findUnique({
      where: { id: managerId },
      select: {
        id: true,
        status: true,
        managerId: true,
        firstName: true,
        lastName: true,
        preferredName: true,
      },
    });
    if (!manager || manager.status === 'EXITED') {
      throw new AppError('VALIDATION_FAILED', 'Choose a current employee as manager', 400, [
        { path: 'managerId', message: 'Choose a current employee' },
      ]);
    }
    let current: string | null = manager.id;
    for (let depth = 0; current && depth < 100; depth++) {
      if (current === employeeId) {
        throw new AppError(
          'MANAGER_CYCLE',
          'This would make the employee their own manager further up the chain',
          409,
          [{ path: 'managerId', message: 'Already reports to this employee' }],
        );
      }
      const next: { managerId: string | null } | null = await tx.employee.findUnique({
        where: { id: current },
        select: { managerId: true },
      });
      current = next?.managerId ?? null;
    }
    return manager;
  }

  /** Next free automatic code (EMP-0001, …); skips codes someone typed in by hand. */
  async nextCode(tx: TenantTransaction, tenantId: string): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [row] = await tx.$queryRaw<{ n: number }[]>`
        INSERT INTO employee_counter (tenant_id, next_number) VALUES (${tenantId}::uuid, 2)
        ON CONFLICT (tenant_id) DO UPDATE SET next_number = employee_counter.next_number + 1
        RETURNING next_number - 1 AS n`;
      const code = `EMP-${String(row!.n).padStart(4, '0')}`;
      if (
        !(await tx.employee.findUnique({
          where: { tenantId_employeeCode: { tenantId, employeeCode: code } },
        }))
      ) {
        return code;
      }
    }
    throw new AppError('CODE_UNAVAILABLE', 'Couldn’t find a free employee number. Enter one yourself.', 409);
  }

  private uniqueError(error: unknown): never {
    if (isUniqueViolation(error)) {
      const target = JSON.stringify((error as { meta?: unknown }).meta ?? '');
      if (target.includes('work_email') || target.includes('workEmail')) {
        throw new AppError('EMAIL_TAKEN', 'Another employee already uses this work email', 409, [
          { path: 'workEmail', message: 'Already in use' },
        ]);
      }
      throw new AppError('CODE_TAKEN', 'Another employee already uses this employee code', 409, [
        { path: 'employeeCode', message: 'Already in use' },
      ]);
    }
    throw error;
  }

  async event(
    tx: TenantTransaction,
    tenantId: string,
    employeeId: string,
    kind: EmployeeEventKind,
    effectiveDate: Date,
    changes: Record<string, { from: unknown; to: unknown }>,
    note: string | null | undefined,
    actorUserId: string,
  ) {
    await tx.employeeEvent.create({
      data: {
        tenantId,
        employeeId,
        kind,
        effectiveDate,
        changes: changes as Prisma.InputJsonValue,
        note: note ?? null,
        actorUserId,
      },
    });
  }

  // ---- Creating and correcting --------------------------------------------------------------------

  async create(tenant: TenantContext, auth: AuthContext, input: CreateEmployee, meta: RequestMeta) {
    return this.run(tenant, auth, (tx) => this.createIn(tx, tenant, auth, input, meta));
  }

  /** Adds an employee inside the caller's transaction (also used when a candidate is hired). */
  async createIn(
    tx: TenantTransaction,
    tenant: TenantContext,
    auth: AuthContext,
    input: CreateEmployee,
    meta: RequestMeta,
  ) {
    const org = await OrgIndex.load(tx, tenant.id);
    const placement = {
      companyId: input.companyId,
      branchId: input.branchId ?? null,
      departmentId: input.departmentId ?? null,
    };
    org.assertPlacement(placement);
    if (!tenant.permissions.allows('employees.manage', org.scopesOf(placement))) {
      throw new ForbiddenError();
    }
    const lookups = await this.checkLookups(tx, {
      designationId: input.designationId,
      gradeId: input.gradeId,
      employmentTypeId: input.employmentTypeId,
      costCentreId: input.costCentreId,
    });
    const manager = await this.checkManager(tx, null, input.managerId);
    await this.entitlements.assertWithinLimit(tx, 'employees.max');
    const employeeCode = input.employeeCode ?? (await this.nextCode(tx, tenant.id));
    let created;
    try {
      created = await tx.employee.create({
        data: {
          tenantId: tenant.id,
          employeeCode,
          firstName: input.firstName,
          lastName: input.lastName,
          preferredName: input.preferredName ?? null,
          workEmail: input.workEmail ? normalizeEmail(input.workEmail) : null,
          personalEmail: input.personalEmail ? normalizeEmail(input.personalEmail) : null,
          phone: input.phone ?? null,
          dateOfBirth: toDateOrNull(input.dateOfBirth) ?? null,
          gender: input.gender ?? null,
          companyId: input.companyId,
          branchId: input.branchId ?? null,
          departmentId: input.departmentId ?? null,
          designationId: input.designationId ?? null,
          gradeId: input.gradeId ?? null,
          employmentTypeId: input.employmentTypeId ?? null,
          costCentreId: input.costCentreId ?? null,
          managerId: input.managerId ?? null,
          dateOfJoining: toDate(input.dateOfJoining),
          probationEndDate: toDateOrNull(input.probationEndDate) ?? null,
        },
        select: { id: true },
      });
    } catch (error) {
      this.uniqueError(error);
    }
    const name = (id: string | null | undefined) => (id ? (lookups.get(id)?.name ?? null) : null);
    await this.event(
      tx,
      tenant.id,
      created.id,
      'JOINED',
      toDate(input.dateOfJoining),
      {
        company: { from: null, to: org.companies.get(input.companyId)?.name ?? null },
        ...(input.branchId
          ? { branch: { from: null, to: org.branches.get(input.branchId)?.name ?? null } }
          : {}),
        ...(input.departmentId
          ? { department: { from: null, to: org.departments.get(input.departmentId)?.name ?? null } }
          : {}),
        ...(input.designationId ? { designation: { from: null, to: name(input.designationId) } } : {}),
        ...(input.gradeId ? { grade: { from: null, to: name(input.gradeId) } } : {}),
        ...(manager ? { manager: { from: null, to: displayName(manager) } } : {}),
      },
      null,
      auth.user.id,
    );
    await this.audit.recordInTransaction(
      tx,
      {
        action: 'employee.create',
        outcome: 'SUCCESS',
        tenantId: tenant.id,
        actorUserId: auth.user.id,
        targetType: 'employee',
        targetId: created.id,
        metadata: { employeeCode },
      },
      meta,
    );
    return present(
      await tx.employee.findUniqueOrThrow({ where: { id: created.id }, select: EMPLOYEE_SELECT }),
    );
  }

  async update(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: UpdateEmployee,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const before = await this.load(tx, tenant, org, id, 'employees.manage');
      if (input.employmentTypeId !== undefined)
        await this.checkLookups(tx, { employmentTypeId: input.employmentTypeId });
      const dob = input.dateOfBirth !== undefined ? input.dateOfBirth : iso(before.dateOfBirth);
      const doj = input.dateOfJoining ?? iso(before.dateOfJoining)!;
      const probation =
        input.probationEndDate !== undefined ? input.probationEndDate : iso(before.probationEndDate);
      if (dob && dob >= doj) throw fieldError('dateOfBirth', 'Must be before the joining date');
      if (probation && probation < doj)
        throw fieldError('probationEndDate', 'Must be on or after the joining date');

      const data: Prisma.EmployeeUncheckedUpdateManyInput = {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.preferredName !== undefined ? { preferredName: input.preferredName } : {}),
        ...(input.workEmail !== undefined
          ? { workEmail: input.workEmail ? normalizeEmail(input.workEmail) : null }
          : {}),
        ...(input.personalEmail !== undefined
          ? { personalEmail: input.personalEmail ? normalizeEmail(input.personalEmail) : null }
          : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.dateOfBirth !== undefined
          ? { dateOfBirth: input.dateOfBirth ? toDate(input.dateOfBirth) : null }
          : {}),
        ...(input.gender !== undefined ? { gender: input.gender } : {}),
        ...(input.employmentTypeId !== undefined ? { employmentTypeId: input.employmentTypeId } : {}),
        ...(input.dateOfJoining !== undefined ? { dateOfJoining: toDate(input.dateOfJoining) } : {}),
        ...(input.probationEndDate !== undefined
          ? { probationEndDate: input.probationEndDate ? toDate(input.probationEndDate) : null }
          : {}),
      };
      await this.applyVersioned(tx, id, input.version, data);
      const after = await tx.employee.findUniqueOrThrow({ where: { id }, select: EMPLOYEE_SELECT });
      const changed = Object.keys(data).filter(
        (k) =>
          JSON.stringify((before as Record<string, unknown>)[k]) !==
          JSON.stringify((after as Record<string, unknown>)[k]),
      );
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'employee.update',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'employee',
          targetId: id,
          // Field names only: personal values stay out of the audit log.
          metadata: { fields: changed },
        },
        meta,
      );
      return present(after);
    });
  }

  /** Writes only if nobody else changed the record since `version` was read. */
  async applyVersioned(
    tx: TenantTransaction,
    id: string,
    version: number,
    data: Prisma.EmployeeUncheckedUpdateManyInput,
  ): Promise<void> {
    let count;
    try {
      ({ count } = await tx.employee.updateMany({
        where: { id, version },
        data: { ...data, version: { increment: 1 } },
      }));
    } catch (error) {
      this.uniqueError(error);
    }
    if (count === 0) {
      throw new AppError(
        'STALE_RECORD',
        'Someone else changed this employee since you opened it. Reload to see their changes, then try again.',
        409,
      );
    }
  }

  // ---- Lifecycle ---------------------------------------------------------------------------------

  /**
   * Works out a lifecycle change and checks it, without writing anything. `permissions` is the requester's,
   * for checks that depend on the destination (a transfer); it is null when an approved change is applied,
   * because the approval is then the authority.
   */
  async prepareLifecycle(
    tx: TenantTransaction,
    permissions: PermissionSet | null,
    org: OrgIndex,
    e: EmployeeRecord,
    input: Lifecycle,
  ): Promise<PreparedChange> {
    const lookupName = async (column: LookupColumn, value: string | null | undefined) =>
      value ? ((await this.checkLookups(tx, { [column]: value })).get(value)?.name ?? null) : null;
    let kind: EmployeeEventKind;
    let effective: Date;
    let data: Prisma.EmployeeUncheckedUpdateManyInput = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    let suspendMembershipId: string | null = null;

    const requireStatus = (...allowed: string[]) => {
      if (!allowed.includes(e.status)) {
        throw new AppError(
          'INVALID_STATUS',
          `Not possible while the employee is ${e.status.toLowerCase().replace('_', ' ')}`,
          409,
        );
      }
    };

    switch (input.action) {
      case 'transfer': {
        requireStatus('ACTIVE', 'ON_NOTICE');
        kind = 'TRANSFER';
        effective = toDate(input.effectiveDate);
        const companyId = input.companyId ?? e.companyId;
        const companyChanged = companyId !== e.companyId;
        // Moving company clears branch and department unless new ones are given.
        const branchId = input.branchId !== undefined ? input.branchId : companyChanged ? null : e.branchId;
        const departmentId =
          input.departmentId !== undefined ? input.departmentId : companyChanged ? null : e.departmentId;
        const target = { companyId, branchId, departmentId };
        org.assertPlacement(target);
        if (permissions && !permissions.allows('employees.lifecycle', org.scopesOf(target)))
          throw new ForbiddenError();
        if (input.costCentreId !== undefined)
          await this.checkLookups(tx, { costCentreId: input.costCentreId });
        data = {
          ...target,
          ...(input.costCentreId !== undefined ? { costCentreId: input.costCentreId } : {}),
        };
        if (companyChanged)
          changes.company = { from: e.company.name, to: org.companies.get(companyId)?.name };
        if (branchId !== e.branchId)
          changes.branch = {
            from: e.branch?.name ?? null,
            to: branchId ? org.branches.get(branchId)?.name : null,
          };
        if (departmentId !== e.departmentId) {
          changes.department = {
            from: e.department?.name ?? null,
            to: departmentId ? org.departments.get(departmentId)?.name : null,
          };
        }
        if (input.costCentreId !== undefined && input.costCentreId !== e.costCentreId) {
          changes.costCentre = {
            from: e.costCentre?.name ?? null,
            to: await lookupName('costCentreId', input.costCentreId),
          };
        }
        break;
      }
      case 'promotion': {
        requireStatus('ACTIVE', 'ON_NOTICE');
        kind = 'PROMOTION';
        effective = toDate(input.effectiveDate);
        if (input.designationId !== undefined && input.designationId !== e.designationId) {
          data.designationId = input.designationId;
          changes.designation = {
            from: e.designation?.name ?? null,
            to: await lookupName('designationId', input.designationId),
          };
        }
        if (input.gradeId !== undefined && input.gradeId !== e.gradeId) {
          data.gradeId = input.gradeId;
          changes.grade = { from: e.grade?.name ?? null, to: await lookupName('gradeId', input.gradeId) };
        }
        break;
      }
      case 'change_manager': {
        requireStatus('ACTIVE', 'ON_NOTICE');
        kind = 'MANAGER_CHANGE';
        effective = toDate(input.effectiveDate);
        const manager = await this.checkManager(tx, e.id, input.managerId);
        if (input.managerId !== e.managerId) {
          data.managerId = input.managerId;
          changes.manager = {
            from: e.manager ? displayName(e.manager) : null,
            to: manager ? displayName(manager) : null,
          };
        }
        break;
      }
      case 'notice': {
        requireStatus('ACTIVE');
        kind = 'NOTICE';
        effective = toDate(input.noticeGivenOn);
        if (input.lastWorkingDay < input.noticeGivenOn)
          throw fieldError('lastWorkingDay', 'Must be on or after the notice date');
        await this.checkLookups(tx, { exitReasonId: input.exitReasonId });
        data = {
          status: 'ON_NOTICE',
          noticeGivenOn: toDate(input.noticeGivenOn),
          lastWorkingDay: toDate(input.lastWorkingDay),
          exitReasonId: input.exitReasonId ?? null,
        };
        changes.status = { from: 'ACTIVE', to: 'ON_NOTICE' };
        changes.lastWorkingDay = { from: null, to: input.lastWorkingDay };
        break;
      }
      case 'withdraw_notice': {
        requireStatus('ON_NOTICE');
        kind = 'NOTICE_WITHDRAWN';
        effective = toDate(input.effectiveDate);
        data = { status: 'ACTIVE', noticeGivenOn: null, lastWorkingDay: null, exitReasonId: null };
        changes.status = { from: 'ON_NOTICE', to: 'ACTIVE' };
        break;
      }
      case 'exit': {
        requireStatus('ACTIVE', 'ON_NOTICE');
        kind = 'EXIT';
        effective = toDate(input.exitedOn);
        if (input.exitedOn < iso(e.dateOfJoining)!)
          throw fieldError('exitedOn', 'Must be on or after the joining date');
        const reason = await lookupName('exitReasonId', input.exitReasonId);
        const reports = await tx.employee.count({ where: { managerId: e.id, status: { not: 'EXITED' } } });
        if (reports > 0) {
          throw new AppError(
            'HAS_REPORTS',
            `${reports} ${reports === 1 ? 'person reports' : 'people report'} to this employee. Give them a new manager first.`,
            409,
          );
        }
        data = {
          status: 'EXITED',
          exitedOn: toDate(input.exitedOn),
          exitReasonId: input.exitReasonId,
          lastWorkingDay: e.lastWorkingDay ?? toDate(input.exitedOn),
        };
        changes.status = { from: e.status, to: 'EXITED' };
        changes.exitReason = { from: null, to: reason };
        // Leavers can't sign in to this organisation any more; their account and history stay.
        if (e.membershipId) {
          suspendMembershipId = e.membershipId;
          changes.signIn = { from: 'ACTIVE', to: 'SUSPENDED' };
        }
        break;
      }
    }

    if (Object.keys(changes).length === 0) {
      throw new AppError('NOTHING_CHANGED', 'Nothing would change. Choose a different value.', 400);
    }
    return { kind, effective, data, changes, suspendMembershipId };
  }

  /** Writes a prepared change: the record (checked against `version` when given), the history event, sign-in. */
  async applyLifecycle(
    tx: TenantTransaction,
    tenantId: string,
    id: string,
    prepared: PreparedChange,
    version: number | null,
    note: string | null | undefined,
    actorUserId: string,
  ) {
    if (version === null) {
      await tx.employee.updateMany({ where: { id }, data: { ...prepared.data, version: { increment: 1 } } });
    } else {
      await this.applyVersioned(tx, id, version, prepared.data);
    }
    if (prepared.suspendMembershipId) {
      await tx.tenantMembership.update({
        where: { id: prepared.suspendMembershipId },
        data: { status: 'SUSPENDED' },
      });
    }
    await this.event(
      tx,
      tenantId,
      id,
      prepared.kind,
      prepared.effective,
      prepared.changes,
      note,
      actorUserId,
    );
  }

  /** Applies a lifecycle change straight away (organisations that don't require approval for them). */
  async lifecycle(tenant: TenantContext, auth: AuthContext, id: string, input: Lifecycle, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const e = await this.load(tx, tenant, org, id, 'employees.lifecycle');
      const prepared = await this.prepareLifecycle(tx, tenant.permissions, org, e, input);
      await this.applyLifecycle(tx, tenant.id, id, prepared, input.version, input.note, auth.user.id);
      await this.audit.recordInTransaction(
        tx,
        {
          action: `employee.${input.action}`,
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'employee',
          targetId: id,
          metadata: { fields: Object.keys(prepared.changes), effectiveDate: iso(prepared.effective) },
        },
        meta,
      );
      return present(await tx.employee.findUniqueOrThrow({ where: { id }, select: EMPLOYEE_SELECT }));
    });
  }

  // ---- Emergency contacts ------------------------------------------------------------------------

  async contacts(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) => {
      await this.load(tx, tenant, await OrgIndex.load(tx, tenant.id), id, 'employees.view');
      return tx.emergencyContact.findMany({
        where: { employeeId: id },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, relationship: true, phone: true, email: true, isPrimary: true },
      });
    });
  }

  async saveContact(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    contactId: string | null,
    input: ContactInput,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.load(tx, tenant, await OrgIndex.load(tx, tenant.id), id, 'employees.manage');
      if (contactId && !(await tx.emergencyContact.findFirst({ where: { id: contactId, employeeId: id } }))) {
        throw new NotFoundError('Contact');
      }
      if (!contactId && (await tx.emergencyContact.count({ where: { employeeId: id } })) >= 5) {
        throw new AppError('TOO_MANY_CONTACTS', 'Keep at most five emergency contacts', 409);
      }
      const data = { ...input, email: input.email ? normalizeEmail(input.email) : null };
      if (input.isPrimary) {
        await tx.emergencyContact.updateMany({
          where: { employeeId: id, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      const saved = contactId
        ? await tx.emergencyContact.update({ where: { id: contactId }, data })
        : await tx.emergencyContact.create({ data: { ...data, tenantId: tenant.id, employeeId: id } });
      await this.audit.recordInTransaction(
        tx,
        {
          action: contactId ? 'employee.contact.update' : 'employee.contact.create',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'employee',
          targetId: id,
          metadata: { contactId: saved.id },
        },
        meta,
      );
      return { id: saved.id };
    });
  }

  async deleteContact(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    contactId: string,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.load(tx, tenant, await OrgIndex.load(tx, tenant.id), id, 'employees.manage');
      const { count } = await tx.emergencyContact.deleteMany({ where: { id: contactId, employeeId: id } });
      if (count === 0) throw new NotFoundError('Contact');
      await this.audit.recordInTransaction(
        tx,
        {
          action: 'employee.contact.delete',
          outcome: 'SUCCESS',
          tenantId: tenant.id,
          actorUserId: auth.user.id,
          targetType: 'employee',
          targetId: id,
          metadata: { contactId },
        },
        meta,
      );
    });
  }
}

export function fieldError(path: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, 400, [{ path, message }]);
}
