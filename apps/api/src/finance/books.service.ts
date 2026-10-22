import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  withContext,
  type ApprovalRequest,
  type DatabaseClient,
  type JournalEntry,
  type Prisma,
  type TenantTransaction,
} from '@smart-hr/database';
import { AppError, ForbiddenError, NotFoundError, type Permission } from '@smart-hr/shared';
import type {
  bookLockSchema,
  journalListQuerySchema,
  journalSchema,
  ledgerAccountSchema,
  reverseJournalSchema,
  updateJournalSchema,
  updateLedgerAccountSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { ApprovalSubjectRegistry } from '../approvals/approval-subjects.js';
import { ApprovalEngine } from '../approvals/approval.engine.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { toDate } from '../employees/employees.service.js';
import { DATABASE } from '../infra/tokens.js';
import { financialYearOf } from '../payroll/statutory-in.js';
import { journalProblems, toPaise, toRupees } from './ledger-calc.js';

export const JOURNAL_SUBJECT = 'journal_entry';
const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | number | null) => (d === null ? 0 : Number(d));

/** The chart every company starts with. System keys mark where the system posts (payroll, bank). */
export const DEFAULT_CHART: {
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  systemKey?: string;
}[] = [
  { code: '1000', name: 'Cash in hand', type: 'ASSET', systemKey: 'CASH' },
  { code: '1100', name: 'Bank', type: 'ASSET', systemKey: 'BANK' },
  { code: '1200', name: 'Accounts receivable', type: 'ASSET', systemKey: 'RECEIVABLES' },
  { code: '1300', name: 'Advances to employees', type: 'ASSET' },
  { code: '2000', name: 'Accounts payable', type: 'LIABILITY' },
  { code: '2100', name: 'Salaries payable', type: 'LIABILITY', systemKey: 'SALARY_PAYABLE' },
  { code: '2200', name: 'Provident fund payable', type: 'LIABILITY', systemKey: 'PF_PAYABLE' },
  { code: '2210', name: 'ESI payable', type: 'LIABILITY', systemKey: 'ESI_PAYABLE' },
  { code: '2220', name: 'Professional tax payable', type: 'LIABILITY', systemKey: 'PT_PAYABLE' },
  { code: '2230', name: 'TDS on salaries payable', type: 'LIABILITY', systemKey: 'TDS_PAYABLE' },
  {
    code: '2240',
    name: 'Other salary deductions payable',
    type: 'LIABILITY',
    systemKey: 'OTHER_DEDUCTIONS_PAYABLE',
  },
  { code: '2310', name: 'Output CGST payable', type: 'LIABILITY', systemKey: 'GST_OUT_CGST' },
  { code: '2320', name: 'Output SGST payable', type: 'LIABILITY', systemKey: 'GST_OUT_SGST' },
  { code: '2330', name: 'Output IGST payable', type: 'LIABILITY', systemKey: 'GST_OUT_IGST' },
  { code: '3000', name: 'Share capital', type: 'EQUITY' },
  { code: '3100', name: 'Retained earnings', type: 'EQUITY', systemKey: 'RETAINED_EARNINGS' },
  { code: '4000', name: 'Revenue from operations', type: 'INCOME', systemKey: 'SALES' },
  { code: '4100', name: 'Other income', type: 'INCOME' },
  { code: '5000', name: 'Salaries and wages', type: 'EXPENSE', systemKey: 'SALARY_EXPENSE' },
  { code: '5100', name: 'Employer PF and ESI', type: 'EXPENSE', systemKey: 'STATUTORY_EXPENSE' },
  { code: '5200', name: 'Rent', type: 'EXPENSE' },
  { code: '5300', name: 'Office and administration', type: 'EXPENSE' },
];

export interface SystemLine {
  /** Either the system's own account by key, or a specific account (for example the bank chosen). */
  systemKey?: string;
  accountId?: string;
  debit: number;
  credit: number;
  narration?: string;
}

const LINE_INCLUDE = {
  lines: {
    orderBy: { position: 'asc' as const },
    include: { account: { select: { id: true, code: true, name: true, type: true } } },
  },
} satisfies Prisma.JournalEntryInclude;
type EntryRow = Prisma.JournalEntryGetPayload<{ include: typeof LINE_INCLUDE }>;

/**
 * The books: a chart of accounts per company, double-entry journals and closing the books. Manual journals
 * go to people for approval (approval subject `journal_entry`, with their amount) and post when approved;
 * journals from approved payroll post directly. Posted journals are never changed — they are reversed. The
 * database enforces balance, closed periods and immutability as well.
 */
@Injectable()
export class BooksService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly engine: ApprovalEngine,
    private readonly subjects: ApprovalSubjectRegistry,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    const back = async (tx: TenantTransaction, request: ApprovalRequest) => {
      await tx.journalEntry.update({
        where: { id: request.subjectId },
        data: { status: 'DRAFT', approvalRequestId: null },
      });
    };
    this.subjects.register(JOURNAL_SUBJECT, {
      onApproved: async (tx, request) => {
        const entry = await tx.journalEntry.findUniqueOrThrow({ where: { id: request.subjectId } });
        await this.post(tx, entry);
      },
      onRejected: back,
      onReturned: back,
      onCancelled: back,
      onResubmitted: async (tx, request) => {
        await tx.journalEntry.update({
          where: { id: request.subjectId },
          data: { status: 'PENDING_APPROVAL' },
        });
      },
      link: (request) => `/finance/journals/${request.subjectId}`,
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

  /** The member holds `code` for this company (or tenant-wide); 404 when they can't even see it. */
  async assertCompany(tx: TenantTransaction, tenant: TenantContext, companyId: string, code: Permission) {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, baseCurrency: true },
    });
    const scopes = [
      { type: 'TENANT' as const, id: tenant.id },
      { type: 'COMPANY' as const, id: companyId },
    ];
    if (!company) throw new NotFoundError('Company');
    if (tenant.permissions.allows(code, scopes)) return company;
    if (tenant.permissions.allows('finance.view', scopes)) throw new ForbiddenError();
    throw new NotFoundError('Company');
  }

  // ---- Chart of accounts ------------------------------------------------------------------------

  /** A company's accounts, creating the starting chart the first time. */
  async chartIn(tx: TenantTransaction, tenantId: string, companyId: string) {
    const count = await tx.ledgerAccount.count({ where: { companyId } });
    if (count === 0) {
      await tx.ledgerAccount.createMany({
        data: DEFAULT_CHART.map((a) => ({ tenantId, companyId, ...a, systemKey: a.systemKey ?? null })),
        skipDuplicates: true,
      });
    }
    return tx.ledgerAccount.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
  }

  /**
   * Makes sure the accounts the system posts to exist in a chart that may predate them: an account with the
   * system's usual code is claimed (when it has the right type), otherwise a new one is created.
   */
  async ensureSystemAccounts(tx: TenantTransaction, tenantId: string, companyId: string) {
    const chart = await this.chartIn(tx, tenantId, companyId);
    for (const want of DEFAULT_CHART.filter((a) => a.systemKey)) {
      if (chart.some((a) => a.systemKey === want.systemKey)) continue;
      const sameCode = chart.find((a) => a.code === want.code);
      if (sameCode && sameCode.type === want.type && !sameCode.systemKey) {
        await tx.ledgerAccount.update({ where: { id: sameCode.id }, data: { systemKey: want.systemKey! } });
      } else if (!sameCode) {
        await tx.ledgerAccount.create({ data: { tenantId, companyId, ...want, systemKey: want.systemKey! } });
      } else {
        let code = Number(want.code) + 1;
        while (chart.some((a) => a.code === String(code))) code += 1;
        await tx.ledgerAccount.create({
          data: { tenantId, companyId, ...want, code: String(code), systemKey: want.systemKey! },
        });
      }
    }
  }

  async accounts(tenant: TenantContext, auth: AuthContext, companyId: string) {
    return this.run(tenant, auth, async (tx) => {
      await this.assertCompany(tx, tenant, companyId, 'finance.view');
      return this.chartIn(tx, tenant.id, companyId);
    });
  }

  async createAccount(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof ledgerAccountSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.assertCompany(tx, tenant, input.companyId, 'finance.configure');
      await this.chartIn(tx, tenant.id, input.companyId);
      const clash = await tx.ledgerAccount.findFirst({
        where: { companyId: input.companyId, code: input.code },
      });
      if (clash)
        throw new AppError('CODE_TAKEN', 'An account with this code already exists', 409, [
          { path: 'code', message: 'Already used' },
        ]);
      const a = await tx.ledgerAccount.create({
        data: { tenantId: tenant.id, ...input, description: input.description ?? null },
      });
      await this.record(tx, tenant, auth, 'finance.account.create', 'ledger_account', a.id, meta, {
        code: a.code,
      });
      return a;
    });
  }

  async updateAccount(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateLedgerAccountSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const a = await tx.ledgerAccount.findUnique({ where: { id } });
      if (!a) throw new NotFoundError('Account');
      await this.assertCompany(tx, tenant, a.companyId, 'finance.configure');
      if (input.status === 'ARCHIVED' && a.systemKey) {
        throw new AppError(
          'SYSTEM_ACCOUNT',
          'This account is used by payroll postings and can’t be archived',
          409,
        );
      }
      if (input.code && input.code !== a.code) {
        const clash = await tx.ledgerAccount.findFirst({
          where: { companyId: a.companyId, code: input.code },
        });
        if (clash)
          throw new AppError('CODE_TAKEN', 'An account with this code already exists', 409, [
            { path: 'code', message: 'Already used' },
          ]);
      }
      const data: Prisma.LedgerAccountUpdateInput = {};
      for (const [k, v] of Object.entries(input))
        if (v !== undefined) (data as Record<string, unknown>)[k] = v;
      const updated = await tx.ledgerAccount.update({ where: { id }, data });
      await this.record(tx, tenant, auth, 'finance.account.update', 'ledger_account', id, meta);
      return updated;
    });
  }

  // ---- Journals ---------------------------------------------------------------------------------

  present(e: EntryRow) {
    return {
      id: e.id,
      companyId: e.companyId,
      number: e.number,
      date: iso(e.date),
      narration: e.narration,
      source: e.source,
      sourceId: e.sourceId,
      status: e.status,
      total: num(e.total),
      approvalRequestId: e.approvalRequestId,
      reversesId: e.reversesId,
      reversedById: e.reversedById,
      postedAt: e.postedAt,
      createdAt: e.createdAt,
      createdByUserId: e.createdByUserId,
      lines: e.lines.map((l) => ({
        id: l.id,
        account: l.account,
        debit: num(l.debit),
        credit: num(l.credit),
        narration: l.narration,
      })),
    };
  }

  private async lockedUntil(tx: TenantTransaction, companyId: string) {
    return (await tx.bookLock.findFirst({ where: { companyId } }))?.lockedUntil ?? null;
  }

  private async assertOpen(tx: TenantTransaction, companyId: string, date: Date) {
    const locked = await this.lockedUntil(tx, companyId);
    if (locked && date <= locked) {
      throw new AppError(
        'BOOKS_CLOSED',
        `The books are closed up to ${iso(locked)}. Use a later date.`,
        409,
        [{ path: 'date', message: 'In closed books' }],
      );
    }
  }

  /** Checks lines (balance, accounts of this company and active) and writes them to a draft. */
  private async writeLines(
    tx: TenantTransaction,
    tenantId: string,
    companyId: string,
    entryId: string,
    lines: z.output<typeof journalSchema>['lines'],
  ) {
    const problems = journalProblems(lines);
    if (problems.length) {
      throw new AppError(
        'JOURNAL_UNBALANCED',
        problems.join('. '),
        400,
        problems.map((p) => ({ path: 'lines', message: p })),
      );
    }
    const ids = [...new Set(lines.map((l) => l.accountId))];
    const accounts = await tx.ledgerAccount.findMany({
      where: { id: { in: ids }, companyId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (accounts.length !== ids.length) {
      throw new AppError('VALIDATION_FAILED', 'Use active accounts of this company', 400, [
        { path: 'lines', message: 'Unknown account' },
      ]);
    }
    await tx.journalLine.deleteMany({ where: { entryId } });
    await tx.journalLine.createMany({
      data: lines.map((l, i) => ({
        tenantId,
        entryId,
        position: i + 1,
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        narration: l.narration ?? null,
      })),
    });
    return toRupees(lines.reduce((s, l) => s + toPaise(l.debit), 0));
  }

  async createJournal(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof journalSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.assertCompany(tx, tenant, input.companyId, 'finance.manage');
      await this.chartIn(tx, tenant.id, input.companyId);
      await this.assertOpen(tx, input.companyId, toDate(input.date));
      const e = await tx.journalEntry.create({
        data: {
          tenantId: tenant.id,
          companyId: input.companyId,
          date: toDate(input.date),
          narration: input.narration,
          createdByUserId: auth.user.id,
        },
      });
      const total = await this.writeLines(tx, tenant.id, input.companyId, e.id, input.lines);
      await tx.journalEntry.update({ where: { id: e.id }, data: { total } });
      await this.record(tx, tenant, auth, 'finance.journal.create', 'journal_entry', e.id, meta, { total });
      return this.present(
        await tx.journalEntry.findUniqueOrThrow({ where: { id: e.id }, include: LINE_INCLUDE }),
      );
    });
  }

  private async loadEntry(tx: TenantTransaction, tenant: TenantContext, id: string, code: Permission) {
    const e = await tx.journalEntry.findUnique({ where: { id }, include: LINE_INCLUDE });
    if (!e) throw new NotFoundError('Journal');
    const assigned =
      code === 'finance.view'
        ? await tx.approvalTask.count({
            where: {
              request: { subjectType: JOURNAL_SUBJECT, subjectId: id },
              assigneeMembershipId: tenant.membershipId,
            },
          })
        : 0;
    if (!assigned) {
      try {
        await this.assertCompany(tx, tenant, e.companyId, code);
      } catch (err) {
        if (err instanceof NotFoundError) throw new NotFoundError('Journal');
        throw err;
      }
    }
    return e;
  }

  async updateJournal(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateJournalSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const e = await this.loadEntry(tx, tenant, id, 'finance.manage');
      if (e.status !== 'DRAFT')
        throw new AppError('JOURNAL_LOCKED', 'Only a draft journal can be changed', 409);
      if (e.source !== 'MANUAL')
        throw new AppError('JOURNAL_LOCKED', 'Journals made by the system can’t be edited', 409);
      await this.assertOpen(tx, e.companyId, toDate(input.date));
      const total = await this.writeLines(tx, tenant.id, e.companyId, id, input.lines);
      await tx.journalEntry.update({
        where: { id },
        data: { date: toDate(input.date), narration: input.narration, total },
      });
      await this.record(tx, tenant, auth, 'finance.journal.update', 'journal_entry', id, meta, { total });
      return this.present(await tx.journalEntry.findUniqueOrThrow({ where: { id }, include: LINE_INCLUDE }));
    });
  }

  async submitJournal(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const e = await this.loadEntry(tx, tenant, id, 'finance.manage');
      if (e.status !== 'DRAFT')
        throw new AppError('JOURNAL_LOCKED', 'Only a draft journal can be sent for approval', 409);
      await this.assertOpen(tx, e.companyId, e.date);
      const company = await tx.company.findUniqueOrThrow({
        where: { id: e.companyId },
        select: { baseCurrency: true },
      });
      await tx.journalEntry.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } });
      const approval = await this.engine.submit(
        tx,
        {
          tenantId: tenant.id,
          membershipId: tenant.membershipId,
          userId: auth.user.id,
          displayName: auth.user.displayName,
        },
        {
          subjectType: JOURNAL_SUBJECT,
          subjectId: id,
          title: `Journal ${iso(e.date)}: ${e.narration}`.slice(0, 200),
          scope: { type: 'COMPANY', id: e.companyId },
          amount: num(e.total).toFixed(2),
          currency: company.baseCurrency,
        },
        meta,
      );
      const now = await tx.journalEntry.findUniqueOrThrow({ where: { id } });
      if (now.status === 'PENDING_APPROVAL')
        await tx.journalEntry.update({ where: { id }, data: { approvalRequestId: approval.id } });
      await this.record(tx, tenant, auth, 'finance.journal.submit', 'journal_entry', id, meta);
      return this.present(await tx.journalEntry.findUniqueOrThrow({ where: { id }, include: LINE_INCLUDE }));
    });
  }

  /** Numbers and posts a draft or approved journal (database checks balance and closed books again). */
  async post(tx: TenantTransaction, entry: JournalEntry) {
    await this.assertOpen(tx, entry.companyId, entry.date);
    const fy = financialYearOf(entry.date.getUTCFullYear(), entry.date.getUTCMonth() + 1);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`journal-number:${entry.companyId}:${fy}`}))`;
    const prefix = `JV/${fy}/`;
    const last = await tx.journalEntry.findFirst({
      where: { companyId: entry.companyId, number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const next = (last?.number ? Number(last.number.slice(prefix.length)) : 0) + 1;
    return tx.journalEntry.update({
      where: { id: entry.id },
      data: { status: 'POSTED', number: `${prefix}${String(next).padStart(5, '0')}`, postedAt: new Date() },
    });
  }

  async cancelJournal(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const e = await this.loadEntry(tx, tenant, id, 'finance.manage');
      if (e.status !== 'DRAFT') {
        throw new AppError(
          'JOURNAL_LOCKED',
          e.status === 'POSTED'
            ? 'Posted journals are reversed, not cancelled'
            : 'Withdraw it from approval first',
          409,
        );
      }
      await tx.journalEntry.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.record(tx, tenant, auth, 'finance.journal.cancel', 'journal_entry', id, meta);
      return this.present(await tx.journalEntry.findUniqueOrThrow({ where: { id }, include: LINE_INCLUDE }));
    });
  }

  /** Reverses a posted journal with a mirror journal on a date in open books, linking the two. */
  async reverseJournal(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof reverseJournalSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`journal-reverse:${id}`}))`;
      const e = await this.loadEntry(tx, tenant, id, 'finance.manage');
      if (e.status !== 'POSTED')
        throw new AppError('JOURNAL_NOT_POSTED', 'Only a posted journal can be reversed', 409);
      if (e.reversedById)
        throw new AppError('ALREADY_REVERSED', 'This journal has already been reversed', 409);
      if (e.reversesId)
        throw new AppError('IS_REVERSAL', 'A reversal can’t itself be reversed; post a new journal', 409);
      const date = toDate(input.date);
      if (date < e.date)
        throw new AppError('VALIDATION_FAILED', 'A reversal can’t be dated before the journal', 400, [
          { path: 'date', message: 'Too early' },
        ]);
      await this.assertOpen(tx, e.companyId, date);
      const r = await tx.journalEntry.create({
        data: {
          tenantId: tenant.id,
          companyId: e.companyId,
          date,
          narration: input.narration ?? `Reversal of ${e.number}: ${e.narration}`.slice(0, 500),
          source: 'REVERSAL',
          sourceId: e.id,
          reversesId: e.id,
          total: e.total,
          createdByUserId: auth.user.id,
        },
      });
      await tx.journalLine.createMany({
        data: e.lines.map((l, i) => ({
          tenantId: tenant.id,
          entryId: r.id,
          position: i + 1,
          accountId: l.accountId,
          debit: l.credit,
          credit: l.debit,
          narration: l.narration,
        })),
      });
      const posted = await this.post(tx, r);
      await tx.journalEntry.update({ where: { id: e.id }, data: { reversedById: posted.id } });
      await this.record(tx, tenant, auth, 'finance.journal.reverse', 'journal_entry', id, meta, {
        reversal: posted.id,
      });
      return this.present(
        await tx.journalEntry.findUniqueOrThrow({ where: { id: posted.id }, include: LINE_INCLUDE }),
      );
    });
  }

  async getJournal(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) => {
      const e = await this.loadEntry(tx, tenant, id, 'finance.view');
      const scopes = [
        { type: 'TENANT' as const, id: tenant.id },
        { type: 'COMPANY' as const, id: e.companyId },
      ];
      const manage = tenant.permissions.allows('finance.manage', scopes);
      return {
        ...this.present(e),
        can: {
          edit: manage && e.status === 'DRAFT' && e.source === 'MANUAL',
          submit: manage && e.status === 'DRAFT',
          cancel: manage && e.status === 'DRAFT',
          reverse: manage && e.status === 'POSTED' && !e.reversedById && !e.reversesId,
        },
      };
    });
  }

  async listJournals(tenant: TenantContext, auth: AuthContext, q: z.output<typeof journalListQuerySchema>) {
    return this.run(tenant, auth, async (tx) => {
      await this.assertCompany(tx, tenant, q.companyId, 'finance.view');
      const rows = await tx.journalEntry.findMany({
        where: {
          companyId: q.companyId,
          ...(q.status === 'ALL' ? {} : { status: q.status }),
          ...(q.from || q.to
            ? { date: { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) } }
            : {}),
        },
        include: LINE_INCLUDE,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 300,
      });
      return rows.map((r) => this.present(r));
    });
  }

  /**
   * Posts a journal the system made from an already-approved event (payroll), straight away. Lines name
   * accounts by system key; zero lines are left out.
   */
  async postSystem(
    tx: TenantTransaction,
    input: {
      tenantId: string;
      companyId: string;
      date: Date;
      narration: string;
      source: 'PAYROLL' | 'PAYROLL_PAYMENT' | 'SALES_DOCUMENT' | 'SALES_RECEIPT';
      sourceId: string;
      createdByUserId: string;
      lines: SystemLine[];
    },
  ) {
    const existing = await tx.journalEntry.findFirst({
      where: { source: input.source, sourceId: input.sourceId, status: 'POSTED' },
      select: { id: true },
    });
    if (existing) return existing;
    const chart = await this.chartIn(tx, input.tenantId, input.companyId);
    const byKey = new Map(chart.filter((a) => a.systemKey).map((a) => [a.systemKey!, a]));
    const lines = input.lines
      .filter((l) => toPaise(l.debit) > 0 || toPaise(l.credit) > 0)
      .map((l) => {
        if (l.accountId) {
          return { accountId: l.accountId, debit: l.debit, credit: l.credit, narration: l.narration ?? null };
        }
        const account = l.systemKey ? byKey.get(l.systemKey) : undefined;
        if (!account) throw new AppError('ACCOUNT_MISSING', `No account is set for ${l.systemKey}`, 409);
        return { accountId: account.id, debit: l.debit, credit: l.credit, narration: l.narration ?? null };
      });
    // Closed books: post on the first open day instead of in the closed period.
    const locked = await this.lockedUntil(tx, input.companyId);
    let date = input.date;
    let narration = input.narration;
    if (locked && date <= locked) {
      date = new Date(locked.getTime() + 86_400_000);
      narration = `${narration} (books for ${iso(input.date)} were closed)`;
    }
    const e = await tx.journalEntry.create({
      data: {
        tenantId: input.tenantId,
        companyId: input.companyId,
        date,
        narration,
        source: input.source,
        sourceId: input.sourceId,
        createdByUserId: input.createdByUserId,
      },
    });
    const total = await this.writeLines(tx, input.tenantId, input.companyId, e.id, lines);
    const withTotal = await tx.journalEntry.update({ where: { id: e.id }, data: { total } });
    return this.post(tx, withTotal);
  }

  // ---- Closing the books ------------------------------------------------------------------------

  async lock(tenant: TenantContext, auth: AuthContext, companyId: string) {
    return this.run(tenant, auth, async (tx) => {
      await this.assertCompany(tx, tenant, companyId, 'finance.view');
      const l = await this.lockedUntil(tx, companyId);
      return { lockedUntil: l ? iso(l) : null };
    });
  }

  async setLock(
    tenant: TenantContext,
    auth: AuthContext,
    companyId: string,
    input: z.output<typeof bookLockSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.assertCompany(tx, tenant, companyId, 'finance.configure');
      const before = await this.lockedUntil(tx, companyId);
      if (input.lockedUntil) {
        const until = toDate(input.lockedUntil);
        const open = await tx.journalEntry.count({
          where: { companyId, status: { in: ['DRAFT', 'PENDING_APPROVAL'] }, date: { lte: until } },
        });
        if (open) {
          throw new AppError(
            'OPEN_JOURNALS',
            `${open} draft or waiting journal${open === 1 ? ' is' : 's are'} dated on or before then. Post, re-date or cancel ${open === 1 ? 'it' : 'them'} first.`,
            409,
          );
        }
        await tx.bookLock.upsert({
          where: { tenantId_companyId: { tenantId: tenant.id, companyId } },
          create: { tenantId: tenant.id, companyId, lockedUntil: until, updatedByUserId: auth.user.id },
          update: { lockedUntil: until, updatedByUserId: auth.user.id },
        });
      } else {
        await tx.bookLock.deleteMany({ where: { companyId } });
      }
      await this.record(
        tx,
        tenant,
        auth,
        input.lockedUntil && (!before || toDate(input.lockedUntil) >= before)
          ? 'finance.books.close'
          : 'finance.books.reopen',
        'company',
        companyId,
        meta,
        {
          from: before ? iso(before) : 'open',
          to: input.lockedUntil ?? 'open',
        },
      );
      return { lockedUntil: input.lockedUntil };
    });
  }
}
