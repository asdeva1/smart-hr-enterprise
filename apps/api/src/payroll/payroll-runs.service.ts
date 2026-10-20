import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  createNotifications,
  type ApprovalRequest,
  type PayComponent,
  type Payslip,
  type PayrollRun,
  type Prisma,
  type TenantTransaction,
} from '@smart-hr/database';
import { hasFeature } from '@smart-hr/entitlements';
import {
  AppError,
  ForbiddenError,
  NOTIFICATION_CATEGORIES,
  NotFoundError,
  type Permission,
} from '@smart-hr/shared';
import type { payrollListQuerySchema, payrollRunSchema, payslipInputSchema } from '@smart-hr/validation';
import type { z } from 'zod';
import { ApprovalSubjectRegistry } from '../approvals/approval-subjects.js';
import { ApprovalEngine } from '../approvals/approval.engine.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import type { ApiEnv } from '../config/env.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { EmployeeSensitiveService } from '../employees/employee-sensitive.service.js';
import { displayName } from '../employees/employees.service.js';
import { API_ENV } from '../infra/tokens.js';
import {
  calculatePayslip,
  daysInMonth,
  type Adjustment,
  type ComponentInput,
  type Line,
} from './payroll-calc.js';
import { PayrollEvents } from './payroll-events.js';
import { PayrollSetupService, type SalaryLine } from './payroll-setup.service.js';
import { renderPayslipPdf } from './payslip-pdf.js';
import { ESI_RULES, esiPeriodOf, financialYearOf, taxRulesFor } from './statutory-in.js';

export const RUN_SUBJECT = 'payroll_run';
const DONE = ['APPROVED', 'PAID'] as const;
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const num = (d: Prisma.Decimal | number | null) => (d === null ? 0 : Number(d));
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const periodLabel = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;

/** Months of a financial year in order (April first), as year * 12 + month for comparing. */
const ordinal = (year: number, month: number) => year * 12 + month;

/**
 * Monthly payroll per company. A run is calculated from each employee's salary, attendance (loss of pay)
 * and statutory rules, can be corrected while a draft (loss of pay, one-off lines), and then goes to people
 * for approval (approval subject `payroll_run`): the person who prepared it can't approve it, and nothing is
 * approved automatically. Approved payslips are final and visible to employees.
 */
@Injectable()
export class PayrollRunsService implements OnModuleInit {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly setup: PayrollSetupService,
    private readonly engine: ApprovalEngine,
    private readonly subjects: ApprovalSubjectRegistry,
    private readonly entitlements: EntitlementsService,
    private readonly sensitive: EmployeeSensitiveService,
    private readonly events: PayrollEvents,
  ) {}

  onModuleInit(): void {
    const back = async (tx: TenantTransaction, request: ApprovalRequest) => {
      await tx.payrollRun.update({
        where: { id: request.subjectId },
        data: { status: 'DRAFT', approvalRequestId: null },
      });
    };
    this.subjects.register(RUN_SUBJECT, {
      onApproved: (tx, request) => this.approved(tx, request),
      onRejected: back,
      onReturned: back,
      onCancelled: back,
      onResubmitted: async (tx, request) => {
        await tx.payrollRun.update({
          where: { id: request.subjectId },
          data: { status: 'PENDING_APPROVAL' },
        });
      },
      link: (request) => `/payroll/runs/${request.subjectId}`,
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

  private assertCompany(tenant: TenantContext, companyId: string, code: Permission) {
    const scopes = [
      { type: 'TENANT' as const, id: tenant.id },
      { type: 'COMPANY' as const, id: companyId },
    ];
    if (!tenant.permissions.allows(code, scopes)) {
      if (code !== 'payroll.view' && tenant.permissions.allows('payroll.view', scopes))
        throw new ForbiddenError();
      throw new NotFoundError('Payroll run');
    }
  }

  private async loadRun(tx: TenantTransaction, tenant: TenantContext, id: string, code: Permission) {
    const run = await tx.payrollRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundError('Payroll run');
    const assigned = await tx.approvalTask.count({
      where: {
        request: { subjectType: RUN_SUBJECT, subjectId: id },
        assigneeMembershipId: tenant.membershipId,
      },
    });
    if (!(code === 'payroll.view' && assigned)) this.assertCompany(tenant, run.companyId, code);
    return run;
  }

  // ---- Calculating ------------------------------------------------------------------------------

  /** Loss-of-pay days from attendance: absences, half days, and days on unpaid leave. */
  private async lopFromAttendance(tx: TenantTransaction, employeeIds: string[], from: Date, to: Date) {
    const days = await tx.attendanceDay.findMany({
      where: {
        employeeId: { in: employeeIds },
        date: { gte: from, lte: to },
        status: { in: ['ABSENT', 'HALF_DAY', 'ON_LEAVE'] },
      },
      select: { employeeId: true, date: true, status: true },
    });
    const unpaid = await tx.leaveRequest.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: 'APPROVED',
        fromDate: { lte: to },
        toDate: { gte: from },
        leaveType: { paid: false },
      },
      select: { employeeId: true, fromDate: true, toDate: true, halfDay: true },
    });
    const lop = new Map<string, number>();
    for (const d of days) {
      let n = 0;
      if (d.status === 'ABSENT') n = 1;
      else if (d.status === 'HALF_DAY') n = 0.5;
      else {
        const r = unpaid.find(
          (u) => u.employeeId === d.employeeId && u.fromDate <= d.date && u.toDate >= d.date,
        );
        if (r) n = r.halfDay ? 0.5 : 1;
      }
      if (n) lop.set(d.employeeId, (lop.get(d.employeeId) ?? 0) + n);
    }
    return lop;
  }

  /** Calculates (or recalculates) every payslip of a draft run. */
  async calculate(tx: TenantTransaction, run: PayrollRun) {
    if (run.status !== 'DRAFT') throw new AppError('RUN_LOCKED', 'Only a draft run can be recalculated', 409);
    const start = utc(run.year, run.month, 1);
    const end = utc(run.year, run.month + 1, 0);
    const company = await tx.company.findUniqueOrThrow({ where: { id: run.companyId } });
    const settings = await this.setup.settingsIn(tx, run.tenantId, run.companyId);
    const ent = await this.entitlements.forTenant(tx);
    const statutory = company.country === 'IN' && hasFeature(ent, 'payroll.statutory_in');
    const fy = financialYearOf(run.year, run.month);
    const rules = statutory ? taxRulesFor(fy) : null;
    const components = new Map((await this.setup.componentsIn(tx, run.tenantId)).map((c) => [c.id, c]));

    const employees = await tx.employee.findMany({
      where: {
        companyId: run.companyId,
        dateOfJoining: { lte: end },
        OR: [{ exitedOn: null }, { exitedOn: { gte: start } }],
        salaries: { some: { effectiveFrom: { lte: end } } },
      },
      select: { id: true, dateOfJoining: true, exitedOn: true },
    });
    const ids = employees.map((e) => e.id);
    const lop = await this.lopFromAttendance(tx, ids, start, end);
    const existing = new Map(
      (await tx.payslip.findMany({ where: { runId: run.id } })).map((p) => [p.employeeId, p]),
    );
    const fyStart = run.month >= 4 ? ordinal(run.year, 4) : ordinal(run.year - 1, 4);
    const esiStartMonth = esiPeriodOf(run.year, run.month);
    const esiStart = ordinal(Number(esiStartMonth.slice(0, 4)), Number(esiStartMonth.slice(5)));
    const earlier = await tx.payslip.findMany({
      where: { employeeId: { in: ids }, run: { status: { in: [...DONE] } } },
      select: {
        employeeId: true,
        taxable: true,
        deductions: true,
        esiCovered: true,
        run: { select: { year: true, month: true } },
      },
    });

    let totals = { gross: 0, deductions: 0, net: 0, employerCost: 0 };
    for (const e of employees) {
      const salary = await tx.employeeSalary.findFirstOrThrow({
        where: { employeeId: e.id, effectiveFrom: { lte: end } },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      });
      const lines = (salary.lines as unknown as SalaryLine[]).map((l): ComponentInput | null => {
        const c: PayComponent | undefined = components.get(l.componentId);
        if (!c) return null;
        return {
          code: c.code,
          name: c.name,
          kind: c.kind,
          monthly: l.monthly,
          taxable: c.taxable,
          pfWage: c.pfWage,
          esiWage: c.esiWage,
          prorate: c.prorate,
        };
      });
      const firstDay = e.dateOfJoining > start ? e.dateOfJoining : start;
      const lastDay = e.exitedOn && e.exitedOn < end ? e.exitedOn : end;
      const employedDays = Math.max(0, Math.round((lastDay.getTime() - firstDay.getTime()) / DAY) + 1);
      const prior = existing.get(e.id);
      const lopDays =
        prior?.lopOverride !== null && prior?.lopOverride !== undefined
          ? num(prior.lopOverride)
          : (lop.get(e.id) ?? 0);
      const adjustments = (prior?.adjustments as unknown as Adjustment[] | undefined) ?? [];
      const profile = await this.setup.profileIn(tx, e.id);

      const mine = earlier.filter((p) => p.employeeId === e.id);
      const inFy = mine.filter((p) => {
        const o = ordinal(p.run.year, p.run.month);
        return o >= fyStart && o < ordinal(run.year, run.month);
      });
      const ytdTaxable = inFy.reduce((s, p) => s + num(p.taxable), 0);
      const ytdTds = inFy.reduce(
        (s, p) => s + ((p.deductions as unknown as Line[]).find((d) => d.code === 'TDS')?.amount ?? 0),
        0,
      );
      const inEsiPeriod = mine.filter((p) => {
        const o = ordinal(p.run.year, p.run.month);
        return o >= esiStart && o < ordinal(run.year, run.month);
      });
      const fullEsiWages = lines.reduce(
        (s, l) => s + (l && l.kind === 'EARNING' && l.esiWage ? l.monthly : 0),
        0,
      );
      // ESI coverage is decided at the start of a contribution period and lasts the period.
      const esiCovered =
        statutory && settings.esiEnabled && profile.esiEnabled
          ? inEsiPeriod.length
            ? inEsiPeriod.some((p) => p.esiCovered)
            : fullEsiWages <= ESI_RULES.wageCeiling
          : false;

      const result = calculatePayslip({
        year: run.year,
        month: run.month,
        employedDays,
        lopDays: Math.min(lopDays, employedDays),
        components: lines.filter((l): l is ComponentInput => !!l),
        adjustments,
        statutory: {
          pf:
            statutory && settings.pfEnabled && profile.pfEnabled
              ? {
                  enabled: true,
                  onFullWages: profile.pfOnFullWages,
                  labourCodeWages: settings.labourCodeWages,
                }
              : null,
          esi: { covered: esiCovered },
          pt: statutory ? await this.setup.ptSlabs(tx, profile.ptState) : null,
          tds: rules ? { rules, ytdTaxable, ytdTds } : null,
        },
      });
      const data = {
        employedDays,
        lopDays: Math.min(lopDays, employedDays),
        paidDays: result.paidDays,
        earnings: result.earnings as unknown as Prisma.InputJsonValue,
        deductions: result.deductions as unknown as Prisma.InputJsonValue,
        employer: result.employer as unknown as Prisma.InputJsonValue,
        gross: result.gross,
        totalDeductions: result.totalDeductions,
        net: result.net,
        employerCost: result.employerCost,
        pfWages: result.pfWages,
        esiWages: result.esiWages,
        esiCovered,
        taxable: result.taxableThisMonth,
        tds: (result.tds ?? null) as unknown as Prisma.InputJsonValue,
        warnings: result.warnings as unknown as Prisma.InputJsonValue,
      };
      if (prior) await tx.payslip.update({ where: { id: prior.id }, data });
      else
        await tx.payslip.create({
          data: { tenantId: run.tenantId, runId: run.id, employeeId: e.id, ...data },
        });
      totals = {
        gross: totals.gross + result.gross,
        deductions: totals.deductions + result.totalDeductions,
        net: totals.net + result.net,
        employerCost: totals.employerCost + result.employerCost,
      };
    }
    // People no longer in this month's payroll (say, a salary removed or a company change).
    const gone = [...existing.values()].filter((p) => !ids.includes(p.employeeId)).map((p) => p.id);
    if (gone.length) await tx.payslip.deleteMany({ where: { id: { in: gone } } });
    return tx.payrollRun.update({
      where: { id: run.id },
      data: { ...totals, employeeCount: employees.length, calculatedAt: new Date() },
    });
  }

  // ---- Runs -------------------------------------------------------------------------------------

  private async presentRun(
    tx: TenantTransaction,
    tenant: TenantContext,
    run: PayrollRun,
    withPayslips: boolean,
  ) {
    const company = await tx.company.findUniqueOrThrow({
      where: { id: run.companyId },
      select: { id: true, name: true, baseCurrency: true },
    });
    const scopes = [
      { type: 'TENANT' as const, id: tenant.id },
      { type: 'COMPANY' as const, id: run.companyId },
    ];
    const manage = tenant.permissions.allows('payroll.manage', scopes);
    const payslips = withPayslips
      ? await tx.payslip.findMany({
          where: { runId: run.id },
          include: {
            employee: {
              select: { id: true, employeeCode: true, firstName: true, lastName: true, preferredName: true },
            },
          },
          orderBy: { employee: { employeeCode: 'asc' } },
        })
      : [];
    return {
      id: run.id,
      company,
      year: run.year,
      month: run.month,
      period: periodLabel(run.year, run.month),
      status: run.status,
      employeeCount: run.employeeCount,
      gross: num(run.gross),
      deductions: num(run.deductions),
      net: num(run.net),
      employerCost: num(run.employerCost),
      approvalRequestId: run.approvalRequestId,
      calculatedAt: run.calculatedAt,
      approvedAt: run.approvedAt,
      paidAt: run.paidAt,
      createdAt: run.createdAt,
      payslips: payslips.map((p) => ({
        ...this.presentPayslip(p),
        employee: { id: p.employee.id, name: displayName(p.employee), employeeCode: p.employee.employeeCode },
      })),
      can: {
        manage,
        edit: manage && run.status === 'DRAFT',
        submit: manage && run.status === 'DRAFT' && run.employeeCount > 0,
        markPaid: manage && run.status === 'APPROVED',
        cancel: manage && run.status === 'DRAFT',
        export: manage && (run.status === 'APPROVED' || run.status === 'PAID'),
      },
    };
  }

  presentPayslip(p: Payslip) {
    return {
      id: p.id,
      runId: p.runId,
      employeeId: p.employeeId,
      employedDays: p.employedDays,
      lopDays: num(p.lopDays),
      lopOverride: p.lopOverride === null ? null : num(p.lopOverride),
      paidDays: num(p.paidDays),
      earnings: p.earnings as unknown as Line[],
      deductions: p.deductions as unknown as Line[],
      employer: p.employer as unknown as Line[],
      adjustments: p.adjustments as unknown as Adjustment[],
      gross: num(p.gross),
      totalDeductions: num(p.totalDeductions),
      net: num(p.net),
      employerCost: num(p.employerCost),
      pfWages: num(p.pfWages),
      esiWages: num(p.esiWages),
      esiCovered: p.esiCovered,
      tds: p.tds,
      warnings: p.warnings as unknown as string[],
    };
  }

  async list(tenant: TenantContext, auth: AuthContext, q: z.output<typeof payrollListQuerySchema>) {
    return this.setup.run(tenant, auth, async (tx) => {
      const runs = await tx.payrollRun.findMany({
        where: { ...(q.companyId ? { companyId: q.companyId } : {}), ...(q.year ? { year: q.year } : {}) },
        orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
        take: 100,
      });
      const visible = runs.filter((r) =>
        tenant.permissions.allows('payroll.view', [
          { type: 'TENANT', id: tenant.id },
          { type: 'COMPANY', id: r.companyId },
        ]),
      );
      const out = [];
      for (const r of visible) out.push(await this.presentRun(tx, tenant, r, false));
      return out;
    });
  }

  async create(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof payrollRunSchema>,
    meta: RequestMeta,
  ) {
    return this.setup.run(tenant, auth, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: input.companyId },
        select: { id: true, status: true },
      });
      if (!company || company.status !== 'ACTIVE') throw new NotFoundError('Company');
      this.assertCompany(tenant, input.companyId, 'payroll.manage');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll:${input.companyId}:${input.year}-${input.month}`}))`;
      const clash = await tx.payrollRun.findFirst({
        where: {
          companyId: input.companyId,
          year: input.year,
          month: input.month,
          status: { not: 'CANCELLED' },
        },
        select: { id: true },
      });
      if (clash)
        throw new AppError(
          'RUN_EXISTS',
          `Payroll for ${periodLabel(input.year, input.month)} has already been started`,
          409,
        );
      // Months are paid in order: the month before must be approved first (if it was run at all).
      const later = await tx.payrollRun.findFirst({
        where: {
          companyId: input.companyId,
          status: { in: ['APPROVED', 'PAID'] },
          OR: [{ year: { gt: input.year } }, { year: input.year, month: { gt: input.month } }],
        },
        select: { year: true, month: true },
      });
      if (later) {
        throw new AppError(
          'PERIOD_CLOSED',
          `${periodLabel(later.year, later.month)} is already approved; earlier months can’t be run now. Pay any difference as a one-off line.`,
          409,
        );
      }
      const run = await tx.payrollRun.create({
        data: {
          tenantId: tenant.id,
          companyId: input.companyId,
          year: input.year,
          month: input.month,
          createdByUserId: auth.user.id,
        },
      });
      const calculated = await this.calculate(tx, run);
      await this.setup.record(tx, tenant, auth, 'payroll.run.create', 'payroll_run', run.id, meta, {
        period: `${input.year}-${input.month}`,
      });
      return this.presentRun(tx, tenant, calculated, true);
    });
  }

  async get(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.setup.run(tenant, auth, async (tx) =>
      this.presentRun(tx, tenant, await this.loadRun(tx, tenant, id, 'payroll.view'), true),
    );
  }

  async recalculate(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.setup.run(tenant, auth, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll-run:${id}`}))`;
      const run = await this.loadRun(tx, tenant, id, 'payroll.manage');
      const done = await this.calculate(tx, run);
      await this.setup.record(tx, tenant, auth, 'payroll.run.recalculate', 'payroll_run', id, meta);
      return this.presentRun(tx, tenant, done, true);
    });
  }

  /** Corrects one draft payslip (loss of pay, one-off lines) and recalculates the run. */
  async editPayslip(
    tenant: TenantContext,
    auth: AuthContext,
    payslipId: string,
    input: z.output<typeof payslipInputSchema>,
    meta: RequestMeta,
  ) {
    return this.setup.run(tenant, auth, async (tx) => {
      const p = await tx.payslip.findUnique({ where: { id: payslipId } });
      if (!p) throw new NotFoundError('Payslip');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll-run:${p.runId}`}))`;
      const run = await this.loadRun(tx, tenant, p.runId, 'payroll.manage');
      if (run.status !== 'DRAFT') throw new AppError('RUN_LOCKED', 'This run is no longer a draft', 409);
      await tx.payslip.update({
        where: { id: payslipId },
        data: {
          ...(input.lopOverride !== undefined ? { lopOverride: input.lopOverride } : {}),
          ...(input.adjustments !== undefined ? { adjustments: input.adjustments } : {}),
        },
      });
      const done = await this.calculate(tx, run);
      await this.setup.record(tx, tenant, auth, 'payroll.payslip.edit', 'payslip', payslipId, meta, {
        employeeId: p.employeeId,
      });
      return this.presentRun(tx, tenant, done, true);
    });
  }

  async submit(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.setup.run(tenant, auth, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll-run:${id}`}))`;
      const run = await this.loadRun(tx, tenant, id, 'payroll.manage');
      if (run.status !== 'DRAFT')
        throw new AppError('RUN_LOCKED', 'Only a draft run can be sent for approval', 409);
      // Approvers see figures calculated now, from today's attendance and salaries.
      const fresh = await this.calculate(tx, run);
      if (fresh.employeeCount === 0)
        throw new AppError('RUN_EMPTY', 'Nobody is in this payroll yet; add salaries first', 409);
      const negative = await tx.payslip.count({ where: { runId: id, net: { lt: 0 } } });
      if (negative) {
        throw new AppError(
          'NEGATIVE_PAY',
          `${negative} payslip${negative === 1 ? ' has' : 's have'} deductions above pay. Correct ${negative === 1 ? 'it' : 'them'} first.`,
          409,
        );
      }
      await tx.payrollRun.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } });
      const company = await tx.company.findUniqueOrThrow({
        where: { id: run.companyId },
        select: { name: true, baseCurrency: true },
      });
      const approval = await this.engine.submit(
        tx,
        this.actor(tenant, auth),
        {
          subjectType: RUN_SUBJECT,
          subjectId: id,
          title: `Payroll ${periodLabel(run.year, run.month)}: ${company.name}, ${fresh.employeeCount} ${fresh.employeeCount === 1 ? 'person' : 'people'}`,
          scope: { type: 'COMPANY', id: run.companyId },
          amount: String(num(fresh.net)),
          currency: company.baseCurrency,
        },
        meta,
      );
      const now = await tx.payrollRun.findUniqueOrThrow({ where: { id } });
      if (now.status === 'PENDING_APPROVAL')
        await tx.payrollRun.update({ where: { id }, data: { approvalRequestId: approval.id } });
      await this.setup.record(tx, tenant, auth, 'payroll.run.submit', 'payroll_run', id, meta, {
        net: num(fresh.net),
      });
      return this.presentRun(tx, tenant, await tx.payrollRun.findUniqueOrThrow({ where: { id } }), true);
    });
  }

  /** Approval: the payslips become final and employees are told. */
  private async approved(tx: TenantTransaction, request: ApprovalRequest) {
    const run = await tx.payrollRun.update({
      where: { id: request.subjectId },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });
    await this.events.emitApproved(tx, run, null);
    const people = await tx.payslip.findMany({
      where: { runId: run.id },
      select: { id: true, employee: { select: { membership: { select: { userId: true, status: true } } } } },
    });
    const userIds = people
      .map((p) => (p.employee.membership?.status === 'ACTIVE' ? p.employee.membership.userId : null))
      .filter((x): x is string => !!x);
    const label = periodLabel(run.year, run.month);
    await createNotifications(tx, run.tenantId, {
      recipientUserIds: userIds,
      category: 'payroll.payslip',
      emailDefault: NOTIFICATION_CATEGORIES['payroll.payslip'].emailDefault,
      title: `Your payslip for ${label} is ready`,
      body: `Your payslip for ${label} is ready to view and download.`,
      link: '/payroll/me',
      email: {
        subject: `Your payslip for ${label}`,
        text: `Your payslip for ${label} is ready. Sign in to view and download it (amounts are not sent by email).\n\n${new URL('/payroll/me', this.env.APP_PUBLIC_URL).toString()}`,
      },
    });
  }

  async markPaid(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.setup.run(tenant, auth, async (tx) => {
      const run = await this.loadRun(tx, tenant, id, 'payroll.manage');
      if (run.status !== 'APPROVED')
        throw new AppError('RUN_NOT_APPROVED', 'Only an approved run can be marked as paid', 409);
      const done = await tx.payrollRun.update({
        where: { id },
        data: { status: 'PAID', paidAt: new Date() },
      });
      await this.events.emitPaid(tx, done, auth.user.id);
      await this.setup.record(tx, tenant, auth, 'payroll.run.paid', 'payroll_run', id, meta);
      return this.presentRun(tx, tenant, done, true);
    });
  }

  async cancel(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.setup.run(tenant, auth, async (tx) => {
      const run = await this.loadRun(tx, tenant, id, 'payroll.manage');
      if (run.status !== 'DRAFT') {
        throw new AppError(
          'RUN_LOCKED',
          run.status === 'PENDING_APPROVAL'
            ? 'Withdraw it from approval first'
            : `This run is ${run.status.toLowerCase()}`,
          409,
        );
      }
      const done = await tx.payrollRun.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.setup.record(tx, tenant, auth, 'payroll.run.cancel', 'payroll_run', id, meta);
      return this.presentRun(tx, tenant, done, false);
    });
  }

  // ---- Files ------------------------------------------------------------------------------------

  private csv(rows: (string | number)[][]) {
    const cell = (v: string | number) => {
      const s = String(v);
      // Neutralise spreadsheet formulas, then quote.
      const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  private async finalRun(tx: TenantTransaction, tenant: TenantContext, id: string) {
    const run = await this.loadRun(tx, tenant, id, 'payroll.manage');
    if (run.status !== 'APPROVED' && run.status !== 'PAID') {
      throw new AppError('RUN_NOT_APPROVED', 'Files are made from approved payroll only', 409);
    }
    const payslips = await tx.payslip.findMany({
      where: { runId: id },
      include: {
        employee: {
          select: { id: true, employeeCode: true, firstName: true, lastName: true, preferredName: true },
        },
      },
      orderBy: { employee: { employeeCode: 'asc' } },
    });
    return { run, payslips };
  }

  /** The payroll register: one row per person with every line. */
  async register(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.setup.run(tenant, auth, async (tx) => {
      const { run, payslips } = await this.finalRun(tx, tenant, id);
      const earnings = [
        ...new Set(payslips.flatMap((p) => (p.earnings as unknown as Line[]).map((l) => l.name))),
      ];
      const deductions = [
        ...new Set(payslips.flatMap((p) => (p.deductions as unknown as Line[]).map((l) => l.name))),
      ];
      const employer = [
        ...new Set(payslips.flatMap((p) => (p.employer as unknown as Line[]).map((l) => l.name))),
      ];
      const amount = (lines: unknown, name: string) =>
        (lines as Line[]).filter((l) => l.name === name).reduce((s, l) => s + l.amount, 0);
      const rows: (string | number)[][] = [
        [
          'Employee code',
          'Name',
          'Paid days',
          'Loss of pay',
          ...earnings,
          'Gross',
          ...deductions,
          'Total deductions',
          'Net pay',
          ...employer,
          'Cost to company',
        ],
        ...payslips.map((p) => [
          p.employee.employeeCode,
          displayName(p.employee),
          num(p.paidDays),
          num(p.lopDays),
          ...earnings.map((n) => amount(p.earnings, n)),
          num(p.gross),
          ...deductions.map((n) => amount(p.deductions, n)),
          num(p.totalDeductions),
          num(p.net),
          ...employer.map((n) => amount(p.employer, n)),
          num(p.employerCost),
        ]),
      ];
      await this.setup.record(tx, tenant, auth, 'payroll.export.register', 'payroll_run', id, meta);
      return {
        data: Buffer.from(this.csv(rows)),
        fileName: `payroll-register-${run.year}-${String(run.month).padStart(2, '0')}.csv`,
        mimeType: 'text/csv',
      };
    });
  }

  /** Bank transfer list with full account numbers (recent sign-in required; audited). */
  async bankFile(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.setup.run(tenant, auth, async (tx) => {
      const { run, payslips } = await this.finalRun(tx, tenant, id);
      const sensitive = await tx.employeeSensitive.findMany({
        where: { employeeId: { in: payslips.map((p) => p.employeeId) } },
      });
      const missing: string[] = [];
      const rows: (string | number)[][] = [
        ['Employee code', 'Name', 'Account number', 'IFSC', 'Bank', 'Amount', 'Reference'],
      ];
      for (const p of payslips) {
        if (num(p.net) <= 0) continue;
        const s = sensitive.find((x) => x.employeeId === p.employeeId);
        const opened = s ? this.sensitive.decryptForExport(s) : null;
        if (!opened?.bankAccount || !s?.bankIfsc) {
          missing.push(p.employee.employeeCode);
          continue;
        }
        rows.push([
          p.employee.employeeCode,
          displayName(p.employee),
          opened.bankAccount,
          s.bankIfsc,
          s.bankName ?? '',
          num(p.net).toFixed(2),
          `SALARY ${run.year}-${String(run.month).padStart(2, '0')}`,
        ]);
      }
      await this.setup.record(tx, tenant, auth, 'payroll.export.bank', 'payroll_run', id, meta, {
        people: rows.length - 1,
        missing: missing.length,
      });
      if (missing.length) rows.push([], [`Not included (no bank account or IFSC): ${missing.join(' ')}`]);
      return {
        data: Buffer.from(this.csv(rows)),
        fileName: `salary-transfers-${run.year}-${String(run.month).padStart(2, '0')}.csv`,
        mimeType: 'text/csv',
      };
    });
  }

  /** EPFO electronic challan-cum-return (ECR) text: one #~#-separated line per member with PF. */
  async pfEcr(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.setup.run(tenant, auth, async (tx) => {
      const { run, payslips } = await this.finalRun(tx, tenant, id);
      const sensitive = await tx.employeeSensitive.findMany({
        where: { employeeId: { in: payslips.map((p) => p.employeeId) } },
        select: { employeeId: true, uan: true },
      });
      const lines: string[] = [];
      const missing: string[] = [];
      for (const p of payslips) {
        const pf = (p.deductions as unknown as Line[]).find((d) => d.code === 'PF');
        if (!pf) continue;
        const uan = sensitive.find((s) => s.employeeId === p.employeeId)?.uan;
        if (!uan) {
          missing.push(p.employee.employeeCode);
          continue;
        }
        const employer = p.employer as unknown as Line[];
        const eps = employer.find((l) => l.code === 'EPS')?.amount ?? 0;
        const er = employer.find((l) => l.code === 'EPF_ER')?.amount ?? 0;
        const capped = Math.min(num(p.pfWages), 15_000);
        // Non-contributing days: days of the month not paid (loss of pay, before joining, after leaving).
        const ncp = Math.round(daysInMonth(run.year, run.month) - num(p.paidDays));
        lines.push(
          [
            uan,
            displayName(p.employee).toUpperCase(),
            Math.round(num(p.gross)),
            Math.round(num(p.pfWages)),
            capped,
            capped,
            pf.amount,
            eps,
            er,
            ncp,
            0,
          ].join('#~#'),
        );
      }
      await this.setup.record(tx, tenant, auth, 'payroll.export.ecr', 'payroll_run', id, meta, {
        members: lines.length,
        missing: missing.length,
      });
      if (missing.length && lines.length === 0) {
        throw new AppError('UAN_MISSING', `No UAN recorded for: ${missing.join(', ')}`, 409);
      }
      return {
        data: Buffer.from(lines.join('\n') + '\n'),
        fileName: `pf-ecr-${run.year}-${String(run.month).padStart(2, '0')}.txt`,
        mimeType: 'text/plain',
        missing,
      };
    });
  }

  // ---- Payslips ---------------------------------------------------------------------------------

  /** My approved payslips, newest first. */
  async mine(tenant: TenantContext, auth: AuthContext) {
    return this.setup.run(tenant, auth, async (tx) => {
      const me = await tx.employee.findFirst({
        where: { membershipId: tenant.membershipId },
        select: { id: true },
      });
      if (!me) return { employee: null, payslips: [] };
      const rows = await tx.payslip.findMany({
        where: { employeeId: me.id, run: { status: { in: [...DONE] } } },
        include: { run: { select: { year: true, month: true } } },
        orderBy: [{ run: { year: 'desc' } }, { run: { month: 'desc' } }],
      });
      return {
        employee: { id: me.id },
        payslips: rows.map((p) => ({
          id: p.id,
          year: p.run.year,
          month: p.run.month,
          period: periodLabel(p.run.year, p.run.month),
          gross: num(p.gross),
          net: num(p.net),
        })),
      };
    });
  }

  /** A payslip for its employee (once approved) or payroll.view where the run's company is. */
  private async loadPayslip(tx: TenantTransaction, tenant: TenantContext, id: string) {
    const p = await tx.payslip.findUnique({
      where: { id },
      include: {
        run: true,
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            preferredName: true,
            membershipId: true,
            dateOfJoining: true,
            designation: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
      },
    });
    if (!p) throw new NotFoundError('Payslip');
    const own =
      p.employee.membershipId === tenant.membershipId &&
      (p.run.status === 'APPROVED' || p.run.status === 'PAID');
    if (!own) await this.loadRun(tx, tenant, p.runId, 'payroll.view');
    return p;
  }

  async payslip(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.setup.run(tenant, auth, async (tx) => {
      const p = await this.loadPayslip(tx, tenant, id);
      return {
        ...this.presentPayslip(p),
        period: periodLabel(p.run.year, p.run.month),
        runStatus: p.run.status,
        employee: { id: p.employee.id, name: displayName(p.employee), employeeCode: p.employee.employeeCode },
      };
    });
  }

  async payslipPdf(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.setup.run(tenant, auth, async (tx) => {
      const p = await this.loadPayslip(tx, tenant, id);
      const company = await tx.company.findUniqueOrThrow({
        where: { id: p.run.companyId },
        select: { name: true, legalName: true },
      });
      const sensitive = await tx.employeeSensitive.findFirst({
        where: { employeeId: p.employeeId },
        select: { panLast4: true, bankAccountLast4: true, uan: true },
      });
      const pdf = await renderPayslipPdf({
        company: company.legalName ?? company.name,
        period: periodLabel(p.run.year, p.run.month),
        draft: p.run.status === 'DRAFT' || p.run.status === 'PENDING_APPROVAL',
        employee: {
          name: displayName(p.employee),
          code: p.employee.employeeCode,
          designation: p.employee.designation?.name ?? null,
          department: p.employee.department?.name ?? null,
          joined: iso(p.employee.dateOfJoining),
          pan: sensitive?.panLast4 ? `••••${sensitive.panLast4}` : null,
          bank: sensitive?.bankAccountLast4 ? `••••${sensitive.bankAccountLast4}` : null,
          uan: sensitive?.uan ?? null,
        },
        days: { inMonth: p.employedDays, paid: num(p.paidDays), lop: num(p.lopDays) },
        earnings: p.earnings as unknown as Line[],
        deductions: p.deductions as unknown as Line[],
        gross: num(p.gross),
        totalDeductions: num(p.totalDeductions),
        net: num(p.net),
      });
      await this.setup.record(tx, tenant, auth, 'payroll.payslip.download', 'payslip', id, meta);
      return {
        data: Buffer.from(pdf),
        fileName: `payslip-${p.employee.employeeCode}-${p.run.year}-${String(p.run.month).padStart(2, '0')}.pdf`,
        mimeType: 'application/pdf',
      };
    });
  }
}
