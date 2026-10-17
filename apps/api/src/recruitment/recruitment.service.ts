import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  createNotifications,
  withContext,
  type ApprovalRequest,
  type DatabaseClient,
  type JobOpening,
  type Prisma,
  type TenantTransaction,
} from '@smart-hr/database';
import {
  AppError,
  ForbiddenError,
  NOTIFICATION_CATEGORIES,
  NotFoundError,
  type ScopeRef,
} from '@smart-hr/shared';
import type {
  applicationSchema,
  jobOpeningSchema,
  moveStageSchema,
  openingListQuerySchema,
  openingStatusSchema,
  updateJobOpeningSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { ApprovalSubjectRegistry } from '../approvals/approval-subjects.js';
import { ApprovalEngine } from '../approvals/approval.engine.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import type { ApiEnv } from '../config/env.js';
import type { UploadedFile } from '../documents/documents.service.js';
import { cleanFileName, detectFileKind } from '../documents/file-types.js';
import { FilesService } from '../documents/files.service.js';
import { displayName } from '../employees/employees.service.js';
import { OrgIndex } from '../employees/org-index.js';
import { API_ENV, DATABASE } from '../infra/tokens.js';

export const OPENING_SUBJECT = 'job_requisition';

const RESUME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

const CLOSED_STAGES = new Set(['HIRED', 'REJECTED', 'WITHDRAWN']);

export interface OpeningAccess {
  view: boolean;
  manage: boolean;
  hiringManager: boolean;
}

const OPENING_INCLUDE = {
  company: { select: { id: true, name: true } },
  _count: { select: { applications: true } },
} satisfies Prisma.JobOpeningInclude;
type OpeningRow = Prisma.JobOpeningGetPayload<{ include: typeof OPENING_INCLUDE }>;

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function openingScope(o: Pick<JobOpening, 'companyId' | 'branchId' | 'departmentId'>): ScopeRef {
  if (o.departmentId) return { type: 'DEPARTMENT', id: o.departmentId };
  if (o.branchId) return { type: 'BRANCH', id: o.branchId };
  return { type: 'COMPANY', id: o.companyId };
}

/**
 * Job openings and the candidates in them. Recruiters act where they hold recruitment.manage (the opening's
 * company, branch or department); recruitment.view sees; an opening's hiring manager sees its pipeline.
 * Openings go through approval before they take candidates; nothing here is decided without a person.
 */
@Injectable()
export class RecruitmentService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly engine: ApprovalEngine,
    private readonly subjects: ApprovalSubjectRegistry,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    const back = async (tx: TenantTransaction, request: ApprovalRequest) => {
      await tx.jobOpening.update({
        where: { id: request.subjectId },
        data: { status: 'DRAFT', approvalRequestId: null },
      });
    };
    this.subjects.register(OPENING_SUBJECT, {
      onApproved: async (tx, request) => {
        await tx.jobOpening.update({
          where: { id: request.subjectId },
          data: { status: 'OPEN', openedAt: new Date() },
        });
      },
      onRejected: back,
      onReturned: back,
      onCancelled: back,
      onResubmitted: async (tx, request) => {
        await tx.jobOpening.update({
          where: { id: request.subjectId },
          data: { status: 'PENDING_APPROVAL' },
        });
      },
      link: (request) => `/recruitment/openings/${request.subjectId}`,
    });
  }

  run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, work);
  }

  record(
    tx: TenantTransaction,
    tenant: TenantContext,
    auth: AuthContext,
    action: string,
    targetType: string,
    targetId: string,
    meta: RequestMeta,
    metadata: Record<string, string> = {},
  ) {
    return this.audit.recordInTransaction(
      tx,
      {
        action,
        outcome: 'SUCCESS',
        tenantId: tenant.id,
        actorUserId: auth.user.id,
        targetType,
        targetId,
        metadata,
      },
      meta,
    );
  }

  async notify(
    tx: TenantTransaction,
    tenantId: string,
    category: 'recruitment.interview' | 'onboarding.task',
    userIds: string[],
    title: string,
    body: string,
    link: string,
  ) {
    await createNotifications(tx, tenantId, {
      recipientUserIds: userIds,
      category,
      emailDefault: NOTIFICATION_CATEGORIES[category].emailDefault,
      title,
      body,
      link,
      email: { subject: title, text: `${body}\n\n${new URL(link, this.env.APP_PUBLIC_URL).toString()}` },
    });
  }

  // ---- Access -----------------------------------------------------------------------------------

  async myEmployeeId(tx: TenantTransaction, tenant: TenantContext): Promise<string | null> {
    const me = await tx.employee.findFirst({
      where: { membershipId: tenant.membershipId },
      select: { id: true },
    });
    return me?.id ?? null;
  }

  async openingAccess(tx: TenantTransaction, tenant: TenantContext, o: JobOpening): Promise<OpeningAccess> {
    const org = await OrgIndex.load(tx, tenant.id);
    const scopes = org.scopesOf(o);
    const me = o.hiringManagerId ? await this.myEmployeeId(tx, tenant) : null;
    return {
      view: tenant.permissions.allows('recruitment.view', scopes),
      manage: tenant.permissions.allows('recruitment.manage', scopes),
      hiringManager: !!me && me === o.hiringManagerId,
    };
  }

  /** The opening if the member may see it (404 otherwise); `manage` demands recruitment.manage. */
  async loadOpening(tx: TenantTransaction, tenant: TenantContext, id: string, manage = false) {
    const o = await tx.jobOpening.findUnique({ where: { id } });
    if (!o) throw new NotFoundError('Opening');
    const access = await this.openingAccess(tx, tenant, o);
    if (!access.view && !access.manage && !access.hiringManager) throw new NotFoundError('Opening');
    if (manage && !access.manage) throw new ForbiddenError();
    return { o, access };
  }

  private async presentOpening(tx: TenantTransaction, o: OpeningRow, access: OpeningAccess) {
    const org = await OrgIndex.load(tx, o.tenantId);
    const stages = await tx.jobApplication.groupBy({
      by: ['stage'],
      where: { openingId: o.id },
      _count: { _all: true },
    });
    const lookupIds = [o.designationId, o.employmentTypeId].filter((x): x is string => !!x);
    const lookups = lookupIds.length
      ? await tx.lookupValue.findMany({ where: { id: { in: lookupIds } }, select: { id: true, name: true } })
      : [];
    const named = (id: string | null) => (id ? (lookups.find((l) => l.id === id) ?? null) : null);
    const manager = o.hiringManagerId
      ? await tx.employee.findUnique({
          where: { id: o.hiringManagerId },
          select: { id: true, firstName: true, lastName: true, preferredName: true },
        })
      : null;
    const branch = o.branchId ? org.branches.get(o.branchId) : null;
    const department = o.departmentId ? org.departments.get(o.departmentId) : null;
    return {
      id: o.id,
      code: o.code,
      title: o.title,
      company: o.company,
      branch: branch ? { id: o.branchId!, name: branch.name } : null,
      department: department ? { id: o.departmentId!, name: department.name } : null,
      designation: named(o.designationId),
      employmentType: named(o.employmentTypeId),
      hiringManager: manager && { id: manager.id, name: displayName(manager) },
      positions: o.positions,
      description: o.description,
      status: o.status,
      approvalRequestId: o.approvalRequestId,
      openedAt: o.openedAt,
      closedAt: o.closedAt,
      createdAt: o.createdAt,
      applications: o._count.applications,
      stages: Object.fromEntries(stages.map((s) => [s.stage, s._count._all])) as Record<string, number>,
      hired: stages.find((s) => s.stage === 'HIRED')?._count._all ?? 0,
      can: {
        manage: access.manage,
        edit: access.manage && o.status !== 'CLOSED',
        submit: access.manage && o.status === 'DRAFT',
        addCandidates: access.manage && o.status === 'OPEN',
      },
    };
  }

  // ---- Openings ---------------------------------------------------------------------------------

  async listOpenings(tenant: TenantContext, auth: AuthContext, q: z.output<typeof openingListQuerySchema>) {
    return this.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const view = org.visibilityFilter(tenant.permissions, 'recruitment.view');
      const manage = org.visibilityFilter(tenant.permissions, 'recruitment.manage');
      const me = await this.myEmployeeId(tx, tenant);
      const or: Prisma.JobOpeningWhereInput[] = [
        ...(view ? view.OR : [{}]),
        ...(manage ? manage.OR : [{}]),
        ...(me ? [{ hiringManagerId: me }] : []),
      ];
      if (or.length === 0) return [];
      const status: Prisma.JobOpeningWhereInput =
        q.status === 'ALL'
          ? {}
          : q.status === 'ACTIVE'
            ? { status: { in: ['DRAFT', 'PENDING_APPROVAL', 'OPEN', 'ON_HOLD'] } }
            : { status: q.status };
      const rows = await tx.jobOpening.findMany({
        where: { AND: [{ OR: or }, status] },
        include: OPENING_INCLUDE,
        orderBy: [{ createdAt: 'desc' }],
        take: 200,
      });
      const out = [];
      for (const r of rows)
        out.push(await this.presentOpening(tx, r, await this.openingAccess(tx, tenant, r)));
      return out;
    });
  }

  async getOpening(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) => {
      const { access } = await this.loadOpening(tx, tenant, id);
      const row = await tx.jobOpening.findUniqueOrThrow({ where: { id }, include: OPENING_INCLUDE });
      return this.presentOpening(tx, row, access);
    });
  }

  private async checkLookups(
    tx: TenantTransaction,
    input: { designationId?: string | null | undefined; employmentTypeId?: string | null | undefined },
  ) {
    for (const [key, kind] of [
      ['designationId', 'designation'],
      ['employmentTypeId', 'employment_type'],
    ] as const) {
      const id = input[key];
      if (!id) continue;
      const found = await tx.lookupValue.findFirst({
        where: { id, list: kind, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!found)
        throw new AppError('VALIDATION_FAILED', 'Choose a value from the list', 400, [
          { path: key, message: 'Not found' },
        ]);
    }
  }

  private async checkManager(tx: TenantTransaction, id: string | null | undefined) {
    if (!id) return;
    const m = await tx.employee.findUnique({ where: { id }, select: { status: true } });
    if (!m || m.status === 'EXITED') {
      throw new AppError('VALIDATION_FAILED', 'Choose a current employee', 400, [
        { path: 'hiringManagerId', message: 'Not a current employee' },
      ]);
    }
  }

  async createOpening(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof jobOpeningSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const placement = {
        companyId: input.companyId,
        branchId: input.branchId ?? null,
        departmentId: input.departmentId ?? null,
      };
      org.assertPlacement(placement);
      if (!tenant.permissions.allows('recruitment.manage', org.scopesOf(placement)))
        throw new ForbiddenError();
      await this.checkLookups(tx, input);
      await this.checkManager(tx, input.hiringManagerId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`job-opening-code:${tenant.id}`}))`;
      const count = await tx.jobOpening.count();
      const o = await tx.jobOpening.create({
        data: {
          tenantId: tenant.id,
          code: `JOB-${String(count + 1).padStart(4, '0')}`,
          title: input.title,
          ...placement,
          designationId: input.designationId ?? null,
          employmentTypeId: input.employmentTypeId ?? null,
          hiringManagerId: input.hiringManagerId ?? null,
          positions: input.positions,
          description: input.description,
          createdByUserId: auth.user.id,
        },
        include: OPENING_INCLUDE,
      });
      await this.record(tx, tenant, auth, 'recruitment.opening.create', 'job_opening', o.id, meta, {
        code: o.code,
      });
      return this.presentOpening(tx, o, await this.openingAccess(tx, tenant, o));
    });
  }

  async updateOpening(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateJobOpeningSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const { o } = await this.loadOpening(tx, tenant, id, true);
      if (o.status === 'CLOSED' || o.status === 'PENDING_APPROVAL') {
        throw new AppError(
          'OPENING_LOCKED',
          o.status === 'CLOSED' ? 'Closed openings can’t be changed' : 'This opening is waiting for approval',
          409,
        );
      }
      const placement = {
        companyId: o.companyId,
        branchId: input.branchId === undefined ? o.branchId : input.branchId,
        departmentId: input.departmentId === undefined ? o.departmentId : input.departmentId,
      };
      const org = await OrgIndex.load(tx, tenant.id);
      org.assertPlacement(placement);
      if (!tenant.permissions.allows('recruitment.manage', org.scopesOf(placement)))
        throw new ForbiddenError();
      await this.checkLookups(tx, input);
      await this.checkManager(tx, input.hiringManagerId);
      const data: Prisma.JobOpeningUpdateInput = {};
      for (const key of [
        'title',
        'branchId',
        'departmentId',
        'designationId',
        'employmentTypeId',
        'hiringManagerId',
        'positions',
        'description',
      ] as const) {
        if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
      }
      const updated = await tx.jobOpening.update({ where: { id }, data, include: OPENING_INCLUDE });
      await this.record(tx, tenant, auth, 'recruitment.opening.update', 'job_opening', id, meta);
      return this.presentOpening(tx, updated, await this.openingAccess(tx, tenant, updated));
    });
  }

  /** Sends a draft opening for approval. */
  async submitOpening(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const { o } = await this.loadOpening(tx, tenant, id, true);
      if (o.status !== 'DRAFT')
        throw new AppError('OPENING_NOT_DRAFT', 'Only draft openings can be sent for approval', 409);
      await tx.jobOpening.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } });
      const approval = await this.engine.submit(
        tx,
        {
          tenantId: tenant.id,
          membershipId: tenant.membershipId,
          userId: auth.user.id,
          displayName: auth.user.displayName,
        },
        {
          subjectType: OPENING_SUBJECT,
          subjectId: o.id,
          title: `New position: ${o.title} (${o.positions})`,
          scope: openingScope(o),
        },
        meta,
      );
      // The engine may have decided at once (say, an auto-approving policy); keep its outcome.
      const now = await tx.jobOpening.findUniqueOrThrow({ where: { id } });
      if (now.status === 'PENDING_APPROVAL') {
        await tx.jobOpening.update({ where: { id }, data: { approvalRequestId: approval.id } });
      }
      await this.record(tx, tenant, auth, 'recruitment.opening.submit', 'job_opening', id, meta);
      const row = await tx.jobOpening.findUniqueOrThrow({ where: { id }, include: OPENING_INCLUDE });
      return this.presentOpening(tx, row, await this.openingAccess(tx, tenant, row));
    });
  }

  async setOpeningStatus(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof openingStatusSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const { o } = await this.loadOpening(tx, tenant, id, true);
      const allowed: Record<string, string[]> = {
        OPEN: ['ON_HOLD', 'CLOSED'],
        ON_HOLD: ['OPEN', 'CLOSED'],
        DRAFT: ['CLOSED'],
      };
      if (!(allowed[o.status] ?? []).includes(input.status)) {
        throw new AppError(
          'OPENING_STATUS',
          `An opening that is ${o.status.toLowerCase().replace('_', ' ')} can’t be made ${input.status.toLowerCase().replace('_', ' ')}`,
          409,
        );
      }
      const updated = await tx.jobOpening.update({
        where: { id },
        data: { status: input.status, ...(input.status === 'CLOSED' ? { closedAt: new Date() } : {}) },
        include: OPENING_INCLUDE,
      });
      await this.record(
        tx,
        tenant,
        auth,
        `recruitment.opening.${input.status.toLowerCase()}`,
        'job_opening',
        id,
        meta,
        input.note ? { note: input.note } : {},
      );
      return this.presentOpening(tx, updated, await this.openingAccess(tx, tenant, updated));
    });
  }

  // ---- Applications -----------------------------------------------------------------------------

  async addApplication(
    tenant: TenantContext,
    auth: AuthContext,
    openingId: string,
    input: z.output<typeof applicationSchema>,
    resume: UploadedFile | undefined,
    meta: RequestMeta,
  ) {
    let resumeKind: string | null = null;
    if (resume && resume.size > 0) {
      const kind = detectFileKind(resume.buffer, cleanFileName(resume.originalname));
      if (!kind || !RESUME_TYPES.has(kind.mimeType)) {
        throw new AppError(
          'FILE_TYPE_NOT_ALLOWED',
          'Upload the résumé as a PDF, Word (.docx) or text file',
          400,
        );
      }
      resumeKind = kind.mimeType;
    }
    return this.run(tenant, auth, async (tx) => {
      const { o } = await this.loadOpening(tx, tenant, openingId, true);
      if (o.status !== 'OPEN')
        throw new AppError('OPENING_NOT_OPEN', 'Candidates can only be added to open positions', 409);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`candidate:${tenant.id}:${input.email}`}))`;
      let candidate = await tx.candidate.findFirst({ where: { email: input.email } });
      const resumeFile =
        resume && resumeKind
          ? await this.files.store(tx, tenant.id, {
              data: resume.buffer,
              fileName: cleanFileName(resume.originalname),
              mimeType: resumeKind,
              uploadedByUserId: auth.user.id,
            })
          : null;
      if (!candidate) {
        candidate = await tx.candidate.create({
          data: {
            tenantId: tenant.id,
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email,
            phone: input.phone ?? null,
            source: input.source ?? null,
            notes: input.notes ?? null,
            resumeFileId: resumeFile?.id ?? null,
            createdByUserId: auth.user.id,
          },
        });
      } else if (resumeFile || (input.phone && !candidate.phone)) {
        candidate = await tx.candidate.update({
          where: { id: candidate.id },
          data: {
            ...(resumeFile ? { resumeFileId: resumeFile.id } : {}),
            ...(input.phone && !candidate.phone ? { phone: input.phone } : {}),
          },
        });
      }
      const existing = await tx.jobApplication.findFirst({
        where: { openingId, candidateId: candidate.id },
        select: { id: true },
      });
      if (existing) {
        throw new AppError('ALREADY_APPLIED', 'This candidate is already in this opening', 409, [
          { path: 'email', message: 'Already in this opening' },
        ]);
      }
      const app = await tx.jobApplication.create({
        data: { tenantId: tenant.id, openingId, candidateId: candidate.id, createdByUserId: auth.user.id },
      });
      await tx.applicationEvent.create({
        data: {
          tenantId: tenant.id,
          applicationId: app.id,
          toStage: 'APPLIED',
          note: input.source ? `Source: ${input.source}` : null,
          actorUserId: auth.user.id,
        },
      });
      await this.record(tx, tenant, auth, 'recruitment.application.create', 'job_application', app.id, meta, {
        openingId,
        candidateId: candidate.id,
      });
      return this.viewApplication(tx, tenant, auth, app.id);
    });
  }

  /** The application if the member may see it: recruiters and viewers where the opening is, its hiring manager, or an interviewer on it. */
  async loadApplication(
    tx: TenantTransaction,
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    manage = false,
  ) {
    const app = await tx.jobApplication.findUnique({ where: { id }, include: { opening: true } });
    if (!app) throw new NotFoundError('Application');
    const access = await this.openingAccess(tx, tenant, app.opening);
    const interviewer =
      (await tx.interviewFeedback.count({
        where: { userId: auth.user.id, interview: { applicationId: id } },
      })) > 0;
    if (!access.view && !access.manage && !access.hiringManager && !interviewer)
      throw new NotFoundError('Application');
    if (manage && !access.manage) throw new ForbiddenError();
    return { app, access, interviewer };
  }

  async viewApplication(tx: TenantTransaction, tenant: TenantContext, auth: AuthContext, id: string) {
    const { access } = await this.loadApplication(tx, tenant, auth, id);
    const a = await tx.jobApplication.findUniqueOrThrow({
      where: { id },
      include: {
        opening: { select: { id: true, code: true, title: true, status: true } },
        candidate: true,
        events: { orderBy: { createdAt: 'asc' } },
        interviews: {
          orderBy: { scheduledAt: 'asc' },
          include: { feedback: { orderBy: { createdAt: 'asc' } } },
        },
        offers: { orderBy: { createdAt: 'desc' } },
      },
    });
    const staff = access.view || access.manage || access.hiringManager;
    const actorIds = [...new Set(a.events.map((e) => e.actorUserId))];
    const actors = actorIds.length
      ? await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } })
      : [];
    const actorName = new Map(actors.map((u) => [u.id, u.displayName]));
    const resume = a.candidate.resumeFileId
      ? await tx.storedFile.findUnique({
          where: { id: a.candidate.resumeFileId },
          select: { fileName: true, sizeBytes: true },
        })
      : null;
    const openOffer = a.offers.find((o) =>
      ['PENDING_APPROVAL', 'RETURNED', 'APPROVED', 'ACCEPTED'].includes(o.status),
    );
    const closed = CLOSED_STAGES.has(a.stage);
    return {
      id: a.id,
      stage: a.stage,
      closedReason: a.closedReason,
      hiredEmployeeId: a.hiredEmployeeId,
      createdAt: a.createdAt,
      opening: a.opening,
      candidate: {
        id: a.candidate.id,
        name: `${a.candidate.firstName} ${a.candidate.lastName}`,
        firstName: a.candidate.firstName,
        lastName: a.candidate.lastName,
        email: a.candidate.email,
        phone: a.candidate.phone,
        source: a.candidate.source,
        notes: staff ? a.candidate.notes : null,
        resume: resume && { name: resume.fileName, size: resume.sizeBytes },
      },
      events: a.events.map((e) => ({
        id: e.id,
        fromStage: e.fromStage,
        toStage: e.toStage,
        note: e.note,
        by: actorName.get(e.actorUserId) ?? null,
        at: e.createdAt,
      })),
      interviews: a.interviews.map((i) => {
        const mine = i.feedback.find((f) => f.userId === auth.user.id);
        // Interviewers see others' feedback only after giving their own, so nobody is swayed.
        const showAll = staff || !!mine?.submittedAt;
        return {
          id: i.id,
          title: i.title,
          scheduledAt: i.scheduledAt,
          durationMinutes: i.durationMinutes,
          location: i.location,
          status: i.status,
          feedback: i.feedback.map((f) => ({
            id: f.id,
            name: f.name,
            mine: f.userId === auth.user.id,
            submitted: !!f.submittedAt,
            submittedAt: f.submittedAt,
            ...(showAll || f.userId === auth.user.id
              ? { rating: f.rating, recommendation: f.recommendation, comments: f.comments }
              : { rating: null, recommendation: null, comments: null }),
          })),
          canGiveFeedback: !!mine && !mine.submittedAt && i.status !== 'CANCELLED',
        };
      }),
      offers: staff
        ? a.offers.map((o) => ({
            id: o.id,
            status: o.status,
            joiningDate: iso(o.joiningDate),
            designationId: o.designationId,
            annualCtc: o.annualCtc ? Number(o.annualCtc) : null,
            currency: o.currency,
            notes: o.notes,
            approvalRequestId: o.approvalRequestId,
            decisionNote: o.decisionNote,
            decidedAt: o.decidedAt,
            respondedAt: o.respondedAt,
            createdAt: o.createdAt,
          }))
        : [],
      can: {
        manage: access.manage,
        move: access.manage && !closed,
        schedule: access.manage && !closed,
        offer: access.manage && !closed && !openOffer,
        hire: access.manage && a.stage === 'OFFER' && a.offers.some((o) => o.status === 'ACCEPTED'),
      },
    };
  }

  async getApplication(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, (tx) => this.viewApplication(tx, tenant, auth, id));
  }

  async listApplications(tenant: TenantContext, auth: AuthContext, openingId: string) {
    return this.run(tenant, auth, async (tx) => {
      await this.loadOpening(tx, tenant, openingId);
      const rows = await tx.jobApplication.findMany({
        where: { openingId },
        include: {
          candidate: { select: { id: true, firstName: true, lastName: true, email: true, source: true } },
          _count: { select: { interviews: true } },
        },
        orderBy: [{ createdAt: 'asc' }],
      });
      return rows.map((r) => ({
        id: r.id,
        stage: r.stage,
        closedReason: r.closedReason,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        interviews: r._count.interviews,
        candidate: {
          id: r.candidate.id,
          name: `${r.candidate.firstName} ${r.candidate.lastName}`,
          email: r.candidate.email,
          source: r.candidate.source,
        },
      }));
    });
  }

  /** Records a stage change, with its history entry. */
  async changeStage(
    tx: TenantTransaction,
    tenantId: string,
    actorUserId: string,
    app: { id: string; stage: string },
    to: 'APPLIED' | 'SCREENING' | 'INTERVIEW' | 'OFFER' | 'HIRED' | 'REJECTED' | 'WITHDRAWN',
    note: string | null,
    extra: Prisma.JobApplicationUncheckedUpdateInput = {},
  ) {
    await tx.jobApplication.update({
      where: { id: app.id },
      data: {
        stage: to,
        ...(to === 'REJECTED' || to === 'WITHDRAWN' ? { closedReason: note } : {}),
        ...extra,
      },
    });
    await tx.applicationEvent.create({
      data: {
        tenantId,
        applicationId: app.id,
        fromStage: app.stage as never,
        toStage: to,
        note,
        actorUserId,
      },
    });
  }

  async moveStage(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof moveStageSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`application:${id}`}))`;
      const { app } = await this.loadApplication(tx, tenant, auth, id, true);
      if (CLOSED_STAGES.has(app.stage))
        throw new AppError('APPLICATION_CLOSED', `This application is ${app.stage.toLowerCase()}`, 409);
      if (app.stage === input.stage)
        throw new AppError('SAME_STAGE', 'The candidate is already at this stage', 409);
      if (input.stage === 'REJECTED' || input.stage === 'WITHDRAWN') {
        // An offer still out is withdrawn with them.
        const offers = await tx.jobOffer.findMany({
          where: { applicationId: id, status: { in: ['PENDING_APPROVAL', 'RETURNED', 'APPROVED'] } },
        });
        for (const offer of offers) {
          if (offer.approvalRequestId && offer.status !== 'APPROVED') {
            await this.engine.cancel(
              tx,
              {
                tenantId: tenant.id,
                membershipId: tenant.membershipId,
                userId: auth.user.id,
                displayName: auth.user.displayName,
              },
              offer.approvalRequestId,
              meta,
            );
          } else {
            await tx.jobOffer.update({
              where: { id: offer.id },
              data: { status: 'CANCELLED', decidedAt: new Date() },
            });
          }
        }
      }
      await this.changeStage(tx, tenant.id, auth.user.id, app, input.stage, input.note ?? null);
      await this.record(tx, tenant, auth, 'recruitment.application.stage', 'job_application', id, meta, {
        from: app.stage,
        to: input.stage,
      });
      return this.viewApplication(tx, tenant, auth, id);
    });
  }

  /** Active members who can be asked to interview, for recruiters. */
  async people(tenant: TenantContext, auth: AuthContext, search: string | undefined) {
    if (!tenant.permissions.hasAnywhere('recruitment.manage')) throw new ForbiddenError();
    return this.run(tenant, auth, async (tx) => {
      const terms = (search ?? '').split(/\s+/).filter(Boolean).slice(0, 4);
      const rows = await tx.tenantMembership.findMany({
        where: {
          status: 'ACTIVE',
          user: {
            status: 'ACTIVE',
            AND: terms.map((t) => ({
              OR: [
                { displayName: { contains: t, mode: 'insensitive' as const } },
                { email: { contains: t, mode: 'insensitive' as const } },
              ],
            })),
          },
        },
        select: { id: true, user: { select: { displayName: true, email: true } } },
        orderBy: { user: { displayName: 'asc' } },
        take: 25,
      });
      return rows.map((m) => ({ membershipId: m.id, name: m.user.displayName, email: m.user.email }));
    });
  }

  async resume(tenant: TenantContext, auth: AuthContext, applicationId: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const { app } = await this.loadApplication(tx, tenant, auth, applicationId);
      const candidate = await tx.candidate.findUniqueOrThrow({ where: { id: app.candidateId } });
      if (!candidate.resumeFileId) throw new NotFoundError('Résumé');
      const file = await tx.storedFile.findUniqueOrThrow({ where: { id: candidate.resumeFileId } });
      const data = await this.files.read(file);
      await this.record(tx, tenant, auth, 'recruitment.resume.download', 'stored_file', file.id, meta, {
        applicationId,
      });
      return { data, fileName: file.fileName, mimeType: file.mimeType };
    });
  }
}
