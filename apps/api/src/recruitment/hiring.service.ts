import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ApprovalRequest, TenantTransaction } from '@smart-hr/database';
import { AppError, ForbiddenError, NotFoundError } from '@smart-hr/shared';
import type {
  feedbackSchema,
  hireSchema,
  interviewSchema,
  interviewStatusSchema,
  offerResponseSchema,
  offerSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { ApprovalSubjectRegistry } from '../approvals/approval-subjects.js';
import { ApprovalEngine } from '../approvals/approval.engine.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { EmployeesService, toDate } from '../employees/employees.service.js';
import { OrgIndex } from '../employees/org-index.js';
import { OnboardingService } from './onboarding.service.js';
import { openingScope, RecruitmentService } from './recruitment.service.js';

export const OFFER_SUBJECT = 'job_offer';
const CLOSED_STAGES = new Set(['HIRED', 'REJECTED', 'WITHDRAWN']);
const OPEN_OFFER = ['PENDING_APPROVAL', 'RETURNED', 'APPROVED', 'ACCEPTED'] as const;

/**
 * Interviews, offers and hiring. An offer goes to people for approval (approval subject `job_offer`, with the
 * offered amount so policies can route by it); the candidate's answer is recorded by a recruiter; hiring an
 * accepted candidate makes their employee record and can start their onboarding. Nothing here is automatic.
 */
@Injectable()
export class HiringService implements OnModuleInit {
  constructor(
    private readonly recruitment: RecruitmentService,
    private readonly employees: EmployeesService,
    private readonly onboarding: OnboardingService,
    private readonly engine: ApprovalEngine,
    private readonly subjects: ApprovalSubjectRegistry,
  ) {}

  onModuleInit(): void {
    const set =
      (status: 'APPROVED' | 'REJECTED' | 'RETURNED' | 'CANCELLED' | 'PENDING_APPROVAL') =>
      async (tx: TenantTransaction, request: ApprovalRequest, comment?: string | null) => {
        await tx.jobOffer.update({
          where: { id: request.subjectId },
          data: {
            status,
            decisionNote: comment ?? null,
            decidedAt: status === 'PENDING_APPROVAL' ? null : new Date(),
          },
        });
      };
    this.subjects.register(OFFER_SUBJECT, {
      onApproved: set('APPROVED'),
      onRejected: set('REJECTED'),
      onReturned: set('RETURNED'),
      onCancelled: set('CANCELLED'),
      onResubmitted: set('PENDING_APPROVAL'),
      link: (request) => `/recruitment/offers/${request.subjectId}`,
    });
  }

  private actor(tenant: TenantContext, auth: AuthContext) {
    return {
      tenantId: tenant.id,
      membershipId: tenant.membershipId,
      userId: auth.user.id,
      displayName: auth.user.displayName,
    };
  }

  private lock(tx: TenantTransaction, applicationId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`application:${applicationId}`}))`;
  }

  // ---- Interviews -------------------------------------------------------------------------------

  async schedule(
    tenant: TenantContext,
    auth: AuthContext,
    applicationId: string,
    input: z.output<typeof interviewSchema>,
    meta: RequestMeta,
  ) {
    return this.recruitment.run(tenant, auth, async (tx) => {
      await this.lock(tx, applicationId);
      const { app } = await this.recruitment.loadApplication(tx, tenant, auth, applicationId, true);
      if (CLOSED_STAGES.has(app.stage)) {
        throw new AppError('APPLICATION_CLOSED', `This application is ${app.stage.toLowerCase()}`, 409);
      }
      const members = await tx.tenantMembership.findMany({
        where: { id: { in: input.interviewerMembershipIds }, status: 'ACTIVE', user: { status: 'ACTIVE' } },
        select: { id: true, userId: true, user: { select: { displayName: true } } },
      });
      if (members.length !== input.interviewerMembershipIds.length) {
        throw new AppError('INTERVIEWER_NOT_AVAILABLE', 'Every interviewer must be an active member', 400, [
          { path: 'interviewerMembershipIds', message: 'Not an active member' },
        ]);
      }
      const interview = await tx.interview.create({
        data: {
          tenantId: tenant.id,
          applicationId,
          title: input.title,
          scheduledAt: new Date(input.scheduledAt),
          durationMinutes: input.durationMinutes,
          location: input.location ?? null,
          createdByUserId: auth.user.id,
          feedback: {
            create: members.map((m) => ({ membershipId: m.id, userId: m.userId, name: m.user.displayName })),
          },
        },
      });
      if (app.stage === 'APPLIED' || app.stage === 'SCREENING') {
        await this.recruitment.changeStage(tx, tenant.id, auth.user.id, app, 'INTERVIEW', input.title);
      }
      const candidate = await tx.candidate.findUniqueOrThrow({ where: { id: app.candidateId } });
      const when = new Date(input.scheduledAt).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      });
      await this.recruitment.notify(
        tx,
        tenant.id,
        'recruitment.interview',
        members.map((m) => m.userId),
        `Interview: ${candidate.firstName} ${candidate.lastName}, ${when}`,
        `You're interviewing ${candidate.firstName} ${candidate.lastName} for ${app.opening.title} (${input.title}) on ${when} IST${input.location ? `, ${input.location}` : ''}. Give your feedback in Smart HR afterwards.`,
        `/recruitment/applications/${applicationId}`,
      );
      await this.recruitment.record(
        tx,
        tenant,
        auth,
        'recruitment.interview.schedule',
        'interview',
        interview.id,
        meta,
        {
          applicationId,
        },
      );
      return this.recruitment.viewApplication(tx, tenant, auth, applicationId);
    });
  }

  async setInterviewStatus(
    tenant: TenantContext,
    auth: AuthContext,
    interviewId: string,
    input: z.output<typeof interviewStatusSchema>,
    meta: RequestMeta,
  ) {
    return this.recruitment.run(tenant, auth, async (tx) => {
      const interview = await tx.interview.findUnique({ where: { id: interviewId } });
      if (!interview) throw new NotFoundError('Interview');
      await this.recruitment.loadApplication(tx, tenant, auth, interview.applicationId, true);
      if (interview.status !== 'SCHEDULED') {
        throw new AppError(
          'INTERVIEW_CLOSED',
          `This interview is already ${interview.status.toLowerCase()}`,
          409,
        );
      }
      await tx.interview.update({ where: { id: interviewId }, data: { status: input.status } });
      await this.recruitment.record(
        tx,
        tenant,
        auth,
        `recruitment.interview.${input.status.toLowerCase()}`,
        'interview',
        interviewId,
        meta,
      );
      return this.recruitment.viewApplication(tx, tenant, auth, interview.applicationId);
    });
  }

  /** Interviews I'm on, newest first, with whether I still owe feedback. */
  async myInterviews(tenant: TenantContext, auth: AuthContext) {
    return this.recruitment.run(tenant, auth, async (tx) => {
      const rows = await tx.interviewFeedback.findMany({
        where: { userId: auth.user.id },
        include: {
          interview: {
            include: {
              application: {
                select: {
                  id: true,
                  candidate: { select: { firstName: true, lastName: true } },
                  opening: { select: { title: true, code: true } },
                },
              },
            },
          },
        },
        orderBy: { interview: { scheduledAt: 'desc' } },
        take: 100,
      });
      return rows.map((f) => ({
        interviewId: f.interviewId,
        applicationId: f.interview.application.id,
        candidate: `${f.interview.application.candidate.firstName} ${f.interview.application.candidate.lastName}`,
        opening: f.interview.application.opening,
        title: f.interview.title,
        scheduledAt: f.interview.scheduledAt,
        location: f.interview.location,
        status: f.interview.status,
        feedbackDue: !f.submittedAt && f.interview.status !== 'CANCELLED',
      }));
    });
  }

  async submitFeedback(
    tenant: TenantContext,
    auth: AuthContext,
    interviewId: string,
    input: z.output<typeof feedbackSchema>,
    meta: RequestMeta,
  ) {
    return this.recruitment.run(tenant, auth, async (tx) => {
      const mine = await tx.interviewFeedback.findFirst({
        where: { interviewId, userId: auth.user.id },
        include: { interview: true },
      });
      if (!mine) throw new NotFoundError('Interview');
      if (mine.submittedAt)
        throw new AppError('FEEDBACK_SUBMITTED', 'You have already given your feedback', 409);
      if (mine.interview.status === 'CANCELLED') {
        throw new AppError('INTERVIEW_CLOSED', 'This interview was cancelled', 409);
      }
      await tx.interviewFeedback.update({
        where: { id: mine.id },
        data: { ...input, submittedAt: new Date() },
      });
      await this.recruitment.record(
        tx,
        tenant,
        auth,
        'recruitment.feedback.submit',
        'interview',
        interviewId,
        meta,
        {
          recommendation: input.recommendation,
        },
      );
      return this.recruitment.viewApplication(tx, tenant, auth, mine.interview.applicationId);
    });
  }

  // ---- Offers -----------------------------------------------------------------------------------

  async createOffer(
    tenant: TenantContext,
    auth: AuthContext,
    applicationId: string,
    input: z.output<typeof offerSchema>,
    meta: RequestMeta,
  ) {
    return this.recruitment.run(tenant, auth, async (tx) => {
      await this.lock(tx, applicationId);
      const { app } = await this.recruitment.loadApplication(tx, tenant, auth, applicationId, true);
      if (CLOSED_STAGES.has(app.stage)) {
        throw new AppError('APPLICATION_CLOSED', `This application is ${app.stage.toLowerCase()}`, 409);
      }
      const open = await tx.jobOffer.count({ where: { applicationId, status: { in: [...OPEN_OFFER] } } });
      if (open) throw new AppError('OFFER_OPEN', 'This candidate already has an offer in progress', 409);
      if (input.designationId) {
        const d = await tx.lookupValue.findFirst({
          where: { id: input.designationId, list: 'designation', status: 'ACTIVE' },
        });
        if (!d) {
          throw new AppError('VALIDATION_FAILED', 'Choose a designation from the list', 400, [
            { path: 'designationId', message: 'Not found' },
          ]);
        }
      }
      const company = await tx.company.findUniqueOrThrow({
        where: { id: app.opening.companyId },
        select: { baseCurrency: true },
      });
      const candidate = await tx.candidate.findUniqueOrThrow({ where: { id: app.candidateId } });
      const offer = await tx.jobOffer.create({
        data: {
          tenantId: tenant.id,
          applicationId,
          designationId: input.designationId ?? app.opening.designationId ?? null,
          joiningDate: toDate(input.joiningDate),
          annualCtc: input.annualCtc ?? null,
          currency: input.annualCtc ? company.baseCurrency : null,
          notes: input.notes ?? null,
          createdByUserId: auth.user.id,
        },
      });
      if (app.stage !== 'OFFER') {
        await this.recruitment.changeStage(tx, tenant.id, auth.user.id, app, 'OFFER', 'Offer prepared');
      }
      const approval = await this.engine.submit(
        tx,
        this.actor(tenant, auth),
        {
          subjectType: OFFER_SUBJECT,
          subjectId: offer.id,
          title: `Offer: ${candidate.firstName} ${candidate.lastName}, ${app.opening.title}`,
          scope: openingScope(app.opening),
          ...(input.annualCtc ? { amount: String(input.annualCtc), currency: company.baseCurrency } : {}),
        },
        meta,
      );
      const now = await tx.jobOffer.findUniqueOrThrow({ where: { id: offer.id } });
      if (now.status === 'PENDING_APPROVAL') {
        await tx.jobOffer.update({ where: { id: offer.id }, data: { approvalRequestId: approval.id } });
      }
      await this.recruitment.record(
        tx,
        tenant,
        auth,
        'recruitment.offer.create',
        'job_offer',
        offer.id,
        meta,
        {
          applicationId,
        },
      );
      return this.recruitment.viewApplication(tx, tenant, auth, applicationId);
    });
  }

  private async loadOffer(
    tx: TenantTransaction,
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    manage = true,
  ) {
    const offer = await tx.jobOffer.findUnique({ where: { id } });
    if (!offer) throw new NotFoundError('Offer');
    const { app, access } = await this.recruitment.loadApplication(tx, tenant, auth, offer.applicationId);
    const assigned = await tx.approvalTask.count({
      where: {
        request: { subjectType: OFFER_SUBJECT, subjectId: id },
        assigneeMembershipId: tenant.membershipId,
      },
    });
    if (!access.view && !access.manage && !access.hiringManager && !assigned)
      throw new NotFoundError('Offer');
    if (manage && !access.manage) throw new ForbiddenError();
    return { offer, app };
  }

  /** One offer (for its approvers too, who may not otherwise see the opening). */
  async getOffer(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.recruitment.run(tenant, auth, async (tx) => {
      const offer = await tx.jobOffer.findUnique({
        where: { id },
        include: {
          application: {
            include: {
              candidate: { select: { firstName: true, lastName: true, email: true } },
              opening: { select: { id: true, code: true, title: true } },
            },
          },
        },
      });
      if (!offer) throw new NotFoundError('Offer');
      const assigned = await tx.approvalTask.count({
        where: {
          request: { subjectType: OFFER_SUBJECT, subjectId: id },
          assigneeMembershipId: tenant.membershipId,
        },
      });
      if (!assigned) await this.loadOffer(tx, tenant, auth, id, false);
      const designation = offer.designationId
        ? await tx.lookupValue.findUnique({ where: { id: offer.designationId }, select: { name: true } })
        : null;
      return {
        id: offer.id,
        status: offer.status,
        applicationId: offer.applicationId,
        candidate: {
          name: `${offer.application.candidate.firstName} ${offer.application.candidate.lastName}`,
          email: offer.application.candidate.email,
        },
        opening: offer.application.opening,
        designation: designation?.name ?? null,
        joiningDate: offer.joiningDate.toISOString().slice(0, 10),
        annualCtc: offer.annualCtc ? Number(offer.annualCtc) : null,
        currency: offer.currency,
        notes: offer.notes,
        approvalRequestId: offer.approvalRequestId,
        decisionNote: offer.decisionNote,
        decidedAt: offer.decidedAt,
        respondedAt: offer.respondedAt,
        createdAt: offer.createdAt,
      };
    });
  }

  async cancelOffer(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.recruitment.run(tenant, auth, async (tx) => {
      const { offer, app } = await this.loadOffer(tx, tenant, auth, id);
      await this.lock(tx, app.id);
      if (offer.status === 'PENDING_APPROVAL' || offer.status === 'RETURNED') {
        await this.engine.cancel(tx, this.actor(tenant, auth), offer.approvalRequestId!, meta);
      } else if (offer.status === 'APPROVED') {
        await tx.jobOffer.update({ where: { id }, data: { status: 'CANCELLED', decidedAt: new Date() } });
      } else {
        throw new AppError('OFFER_CLOSED', `This offer is ${offer.status.toLowerCase()}`, 409);
      }
      await this.recruitment.record(tx, tenant, auth, 'recruitment.offer.withdraw', 'job_offer', id, meta);
      return this.recruitment.viewApplication(tx, tenant, auth, app.id);
    });
  }

  /** Records the candidate's answer to an approved offer. Declining closes the application. */
  async respond(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof offerResponseSchema>,
    meta: RequestMeta,
  ) {
    return this.recruitment.run(tenant, auth, async (tx) => {
      const { offer, app } = await this.loadOffer(tx, tenant, auth, id);
      await this.lock(tx, app.id);
      if (offer.status !== 'APPROVED') {
        throw new AppError(
          'OFFER_NOT_APPROVED',
          offer.status === 'PENDING_APPROVAL' || offer.status === 'RETURNED'
            ? 'This offer hasn’t been approved yet'
            : `This offer is ${offer.status.toLowerCase()}`,
          409,
        );
      }
      await tx.jobOffer.update({
        where: { id },
        data: {
          status: input.response,
          respondedAt: new Date(),
          decisionNote: input.note ?? offer.decisionNote,
        },
      });
      if (input.response === 'DECLINED') {
        await this.recruitment.changeStage(
          tx,
          tenant.id,
          auth.user.id,
          app,
          'WITHDRAWN',
          input.note ? `Declined the offer: ${input.note}` : 'Declined the offer',
        );
      }
      await this.recruitment.record(
        tx,
        tenant,
        auth,
        `recruitment.offer.${input.response.toLowerCase()}`,
        'job_offer',
        id,
        meta,
      );
      return this.recruitment.viewApplication(tx, tenant, auth, app.id);
    });
  }

  // ---- Hiring -----------------------------------------------------------------------------------

  /**
   * Makes the employee record for a candidate who accepted, from the opening and the offer, closes the
   * application as hired, keeps their résumé on the record (HR only), and starts onboarding if asked.
   */
  async hire(
    tenant: TenantContext,
    auth: AuthContext,
    applicationId: string,
    input: z.output<typeof hireSchema>,
    meta: RequestMeta,
  ) {
    return this.recruitment.run(tenant, auth, async (tx) => {
      await this.lock(tx, applicationId);
      const { app } = await this.recruitment.loadApplication(tx, tenant, auth, applicationId, true);
      if (app.stage !== 'OFFER') {
        throw new AppError('NOT_READY_TO_HIRE', 'Only a candidate who accepted an offer can be hired', 409);
      }
      const offer = await tx.jobOffer.findFirst({
        where: { applicationId, status: 'ACCEPTED' },
        orderBy: { createdAt: 'desc' },
      });
      if (!offer)
        throw new AppError('NOT_READY_TO_HIRE', 'Only a candidate who accepted an offer can be hired', 409);
      const candidate = await tx.candidate.findUniqueOrThrow({ where: { id: app.candidateId } });
      const o = app.opening;
      const org = await OrgIndex.load(tx, tenant.id);
      if (!tenant.permissions.allows('employees.manage', org.scopesOf(o))) {
        throw new AppError(
          'FORBIDDEN',
          'Adding the employee record needs permission to manage employees here',
          403,
        );
      }
      const employee = await this.employees.createIn(
        tx,
        tenant,
        auth,
        {
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          personalEmail: candidate.email,
          workEmail: input.workEmail ?? null,
          phone: candidate.phone,
          companyId: o.companyId,
          branchId: o.branchId,
          departmentId: o.departmentId,
          designationId: offer.designationId ?? o.designationId,
          employmentTypeId: o.employmentTypeId,
          managerId: input.managerId ?? o.hiringManagerId,
          dateOfJoining: offer.joiningDate.toISOString().slice(0, 10),
        },
        meta,
      );
      await this.recruitment.changeStage(
        tx,
        tenant.id,
        auth.user.id,
        app,
        'HIRED',
        `Employee ${employee.employeeCode}`,
        { hiredEmployeeId: employee.id },
      );
      if (candidate.resumeFileId) {
        await tx.employeeDocument.create({
          data: {
            tenantId: tenant.id,
            employeeId: employee.id,
            fileId: candidate.resumeFileId,
            title: 'Résumé (from recruitment)',
            category: 'EMPLOYMENT',
            visibleToEmployee: false,
            uploadedByUserId: auth.user.id,
          },
        });
      }
      // The opening closes itself once every position is filled.
      const hired = await tx.jobApplication.count({ where: { openingId: o.id, stage: 'HIRED' } });
      if (hired >= o.positions && o.status !== 'CLOSED') {
        await tx.jobOpening.update({ where: { id: o.id }, data: { status: 'CLOSED', closedAt: new Date() } });
      }
      if (input.onboardingTemplateId) {
        await this.onboarding.startIn(tx, tenant, auth, employee.id, input.onboardingTemplateId, null, meta);
      }
      await this.recruitment.record(
        tx,
        tenant,
        auth,
        'recruitment.hire',
        'job_application',
        applicationId,
        meta,
        {
          employeeId: employee.id,
        },
      );
      return {
        application: await this.recruitment.viewApplication(tx, tenant, auth, applicationId),
        employee,
      };
    });
  }
}
