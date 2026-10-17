import { Inject, Injectable } from '@nestjs/common';
import {
  withContext,
  type DatabaseClient,
  type EmployeeSalary,
  type Prisma,
  type TenantTransaction,
} from '@smart-hr/database';
import { AppError, ForbiddenError, NotFoundError, type Permission } from '@smart-hr/shared';
import type {
  employeePayrollSchema,
  payComponentSchema,
  payrollSettingSchema,
  professionalTaxSchema,
  salarySchema,
  updatePayComponentSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { displayName, toDate } from '../employees/employees.service.js';
import { OrgIndex } from '../employees/org-index.js';
import { DATABASE } from '../infra/tokens.js';
import { DEFAULT_PT, type PtSlab } from './statutory-in.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The pay components every organisation starts with; they can rename them and add their own. */
const DEFAULT_COMPONENTS = [
  {
    code: 'BASIC',
    name: 'Basic',
    kind: 'EARNING',
    taxable: true,
    pfWage: true,
    esiWage: true,
    prorate: true,
    sortOrder: 10,
  },
  {
    code: 'HRA',
    name: 'House rent allowance',
    kind: 'EARNING',
    taxable: true,
    pfWage: false,
    esiWage: true,
    prorate: true,
    sortOrder: 20,
  },
  {
    code: 'SPECIAL',
    name: 'Special allowance',
    kind: 'EARNING',
    taxable: true,
    pfWage: false,
    esiWage: true,
    prorate: true,
    sortOrder: 30,
  },
] as const;

export interface SalaryLine {
  componentId: string;
  code: string;
  name: string;
  monthly: number;
}

/**
 * Payroll set-up: pay components, statutory settings per company, professional-tax tables, each employee's
 * statutory choices, and salary revisions. Salaries are seen and set by payroll.view / payroll.manage where
 * the employee sits; revisions are added and never rewritten.
 */
@Injectable()
export class PayrollSetupService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly audit: AuditService,
  ) {}

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
    metadata: Record<string, string | number> = {},
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

  private assertConfigure(tenant: TenantContext) {
    if (!tenant.permissions.hasAnywhere('payroll.configure')) throw new ForbiddenError();
  }

  /** The employee, if the member holds `code` where they sit (404 for those who can't see them at all). */
  async employeeFor(tx: TenantTransaction, tenant: TenantContext, employeeId: string, code: Permission) {
    const e = await tx.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        companyId: true,
        branchId: true,
        departmentId: true,
        status: true,
        dateOfJoining: true,
      },
    });
    if (!e) throw new NotFoundError('Employee');
    const scopes = (await OrgIndex.load(tx, tenant.id)).scopesOf(e);
    if (!tenant.permissions.allows(code, scopes)) {
      if (code !== 'payroll.view' && tenant.permissions.allows('payroll.view', scopes))
        throw new ForbiddenError();
      throw new NotFoundError('Employee');
    }
    return e;
  }

  // ---- Components -------------------------------------------------------------------------------

  /** The organisation's components, creating the starting set the first time. */
  async componentsIn(tx: TenantTransaction, tenantId: string) {
    const existing = await tx.payComponent.count();
    if (existing === 0) {
      await tx.payComponent.createMany({
        data: DEFAULT_COMPONENTS.map((c) => ({ ...c, tenantId })),
        skipDuplicates: true,
      });
    }
    return tx.payComponent.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
  }

  async components(tenant: TenantContext, auth: AuthContext) {
    if (
      !tenant.permissions.hasAnywhere('payroll.view') &&
      !tenant.permissions.hasAnywhere('payroll.configure')
    ) {
      throw new ForbiddenError();
    }
    return this.run(tenant, auth, (tx) => this.componentsIn(tx, tenant.id));
  }

  async createComponent(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof payComponentSchema>,
    meta: RequestMeta,
  ) {
    this.assertConfigure(tenant);
    return this.run(tenant, auth, async (tx) => {
      await this.componentsIn(tx, tenant.id);
      const clash = await tx.payComponent.findFirst({ where: { code: input.code }, select: { id: true } });
      if (clash) {
        throw new AppError('CODE_TAKEN', 'A component with this code already exists', 409, [
          { path: 'code', message: 'Already used' },
        ]);
      }
      const c = await tx.payComponent.create({ data: { tenantId: tenant.id, ...input } });
      await this.record(tx, tenant, auth, 'payroll.component.create', 'pay_component', c.id, meta, {
        code: c.code,
      });
      return c;
    });
  }

  async updateComponent(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updatePayComponentSchema>,
    meta: RequestMeta,
  ) {
    this.assertConfigure(tenant);
    return this.run(tenant, auth, async (tx) => {
      const c = await tx.payComponent.findUnique({ where: { id } });
      if (!c) throw new NotFoundError('Component');
      const data: Prisma.PayComponentUpdateInput = {};
      for (const [k, v] of Object.entries(input))
        if (v !== undefined) (data as Record<string, unknown>)[k] = v;
      const updated = await tx.payComponent.update({ where: { id }, data });
      await this.record(tx, tenant, auth, 'payroll.component.update', 'pay_component', id, meta);
      return updated;
    });
  }

  // ---- Company settings and professional tax ---------------------------------------------------

  async settingsIn(tx: TenantTransaction, tenantId: string, companyId: string) {
    return (
      (await tx.payrollSetting.findFirst({ where: { companyId } })) ?? {
        companyId,
        tenantId,
        pfEnabled: true,
        esiEnabled: true,
        labourCodeWages: true,
        pfEstablishmentId: null,
        esiEmployerCode: null,
        tan: null,
      }
    );
  }

  private assertCompany(tenant: TenantContext, companyId: string, code: Permission) {
    if (
      !tenant.permissions.allows(code, [
        { type: 'TENANT', id: tenant.id },
        { type: 'COMPANY', id: companyId },
      ])
    ) {
      throw new ForbiddenError();
    }
  }

  async settings(tenant: TenantContext, auth: AuthContext, companyId: string) {
    return this.run(tenant, auth, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { id: true, country: true },
      });
      if (!company) throw new NotFoundError('Company');
      this.assertCompany(tenant, companyId, 'payroll.view');
      return { ...(await this.settingsIn(tx, tenant.id, companyId)), statutory: company.country === 'IN' };
    });
  }

  async saveSettings(
    tenant: TenantContext,
    auth: AuthContext,
    companyId: string,
    input: z.output<typeof payrollSettingSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const company = await tx.company.findUnique({ where: { id: companyId }, select: { id: true } });
      if (!company) throw new NotFoundError('Company');
      this.assertCompany(tenant, companyId, 'payroll.configure');
      const saved = await tx.payrollSetting.upsert({
        where: { tenantId_companyId: { tenantId: tenant.id, companyId } },
        create: { tenantId: tenant.id, companyId, ...input },
        update: input,
      });
      await this.record(tx, tenant, auth, 'payroll.settings.update', 'company', companyId, meta);
      return saved;
    });
  }

  /** The professional-tax table for a state: the organisation's own, else the starting table, else none. */
  async ptSlabs(tx: TenantTransaction, state: string | null): Promise<PtSlab[] | null> {
    if (!state) return null;
    const own = await tx.professionalTaxTable.findFirst({ where: { state } });
    if (own) return own.slabs as unknown as PtSlab[];
    return DEFAULT_PT[state]?.slabs ?? null;
  }

  async ptTables(tenant: TenantContext, auth: AuthContext) {
    if (
      !tenant.permissions.hasAnywhere('payroll.view') &&
      !tenant.permissions.hasAnywhere('payroll.configure')
    ) {
      throw new ForbiddenError();
    }
    return this.run(tenant, auth, async (tx) => {
      const own = await tx.professionalTaxTable.findMany();
      const states = new Set([...Object.keys(DEFAULT_PT), ...own.map((o) => o.state)]);
      return [...states].sort().map((state) => {
        const o = own.find((x) => x.state === state);
        return {
          state,
          name: o?.name ?? DEFAULT_PT[state]?.name ?? state,
          slabs: (o?.slabs as unknown as PtSlab[] | undefined) ?? DEFAULT_PT[state]?.slabs ?? [],
          custom: !!o,
        };
      });
    });
  }

  async savePtTable(
    tenant: TenantContext,
    auth: AuthContext,
    state: string,
    input: z.output<typeof professionalTaxSchema>,
    meta: RequestMeta,
  ) {
    this.assertConfigure(tenant);
    return this.run(tenant, auth, async (tx) => {
      const saved = await tx.professionalTaxTable.upsert({
        where: { tenantId_state: { tenantId: tenant.id, state } },
        create: { tenantId: tenant.id, state, name: input.name, slabs: input.slabs },
        update: { name: input.name, slabs: input.slabs },
      });
      await this.record(tx, tenant, auth, 'payroll.pt.update', 'professional_tax_table', saved.id, meta, {
        state,
      });
      return saved;
    });
  }

  // ---- Employees --------------------------------------------------------------------------------

  async profileIn(tx: TenantTransaction, employeeId: string) {
    return (
      (await tx.employeePayroll.findFirst({ where: { employeeId } })) ?? {
        employeeId,
        pfEnabled: true,
        pfOnFullWages: false,
        esiEnabled: true,
        ptState: null,
      }
    );
  }

  /** Statutory choices and salary history for one employee. */
  async employee(tenant: TenantContext, auth: AuthContext, employeeId: string) {
    return this.run(tenant, auth, async (tx) => {
      const e = await this.employeeFor(tx, tenant, employeeId, 'payroll.view');
      const salaries = await tx.employeeSalary.findMany({
        where: { employeeId },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      });
      const scopes = (await OrgIndex.load(tx, tenant.id)).scopesOf(e);
      const profile = await this.profileIn(tx, employeeId);
      return {
        employee: {
          id: e.id,
          name: displayName(e),
          employeeCode: e.employeeCode,
          dateOfJoining: iso(e.dateOfJoining),
        },
        profile: {
          pfEnabled: profile.pfEnabled,
          pfOnFullWages: profile.pfOnFullWages,
          esiEnabled: profile.esiEnabled,
          ptState: profile.ptState,
        },
        salaries: salaries.map((s) => this.presentSalary(s)),
        can: { manage: tenant.permissions.allows('payroll.manage', scopes) },
      };
    });
  }

  presentSalary(s: EmployeeSalary) {
    const lines = s.lines as unknown as SalaryLine[];
    return {
      id: s.id,
      effectiveFrom: iso(s.effectiveFrom),
      annualCtc: Number(s.annualCtc),
      lines,
      monthlyGross: lines.reduce((sum, l) => sum + l.monthly, 0),
      note: s.note,
      createdAt: s.createdAt,
    };
  }

  async saveProfile(
    tenant: TenantContext,
    auth: AuthContext,
    employeeId: string,
    input: z.output<typeof employeePayrollSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.employeeFor(tx, tenant, employeeId, 'payroll.manage');
      await tx.employeePayroll.upsert({
        where: { tenantId_employeeId: { tenantId: tenant.id, employeeId } },
        create: { tenantId: tenant.id, employeeId, ...input },
        update: input,
      });
      await this.record(tx, tenant, auth, 'payroll.profile.update', 'employee', employeeId, meta);
      return this.profileIn(tx, employeeId);
    });
  }

  async addSalary(
    tenant: TenantContext,
    auth: AuthContext,
    employeeId: string,
    input: z.output<typeof salarySchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const e = await this.employeeFor(tx, tenant, employeeId, 'payroll.manage');
      if (e.status === 'EXITED') throw new AppError('EMPLOYEE_EXITED', 'This employee has left', 409);
      const components = await this.componentsIn(tx, tenant.id);
      const lines: SalaryLine[] = input.lines.map((l) => {
        const c = components.find((x) => x.id === l.componentId && x.status === 'ACTIVE');
        if (!c) {
          throw new AppError('VALIDATION_FAILED', 'Choose active pay components', 400, [
            { path: 'lines', message: 'Unknown component' },
          ]);
        }
        return { componentId: c.id, code: c.code, name: c.name, monthly: l.monthly };
      });
      if (
        !lines.some(
          (l) => components.find((c) => c.id === l.componentId)?.kind === 'EARNING' && l.monthly > 0,
        )
      ) {
        throw new AppError('VALIDATION_FAILED', 'Add at least one earning', 400, [
          { path: 'lines', message: 'No earnings' },
        ]);
      }
      // A revision can't take effect inside a month that has already been paid.
      const paid = await tx.payslip.findFirst({
        where: {
          employeeId,
          run: { status: { in: ['PENDING_APPROVAL', 'APPROVED', 'PAID'] } },
        },
        orderBy: [{ run: { year: 'desc' } }, { run: { month: 'desc' } }],
        select: { run: { select: { year: true, month: true } } },
      });
      if (paid) {
        const lastPaidEnd = new Date(Date.UTC(paid.run.year, paid.run.month, 0));
        if (toDate(input.effectiveFrom) <= lastPaidEnd) {
          throw new AppError(
            'PERIOD_CLOSED',
            `Payroll up to ${iso(lastPaidEnd)} is already done. Make the revision effective after that and pay any arrears as a one-off line.`,
            409,
            [{ path: 'effectiveFrom', message: 'In a paid month' }],
          );
        }
      }
      const s = await tx.employeeSalary.create({
        data: {
          tenantId: tenant.id,
          employeeId,
          effectiveFrom: toDate(input.effectiveFrom),
          annualCtc: input.annualCtc,
          lines: lines as unknown as Prisma.InputJsonValue,
          note: input.note ?? null,
          createdByUserId: auth.user.id,
        },
      });
      await this.record(tx, tenant, auth, 'payroll.salary.revise', 'employee', employeeId, meta, {
        effectiveFrom: input.effectiveFrom,
      });
      return this.presentSalary(s);
    });
  }
}
