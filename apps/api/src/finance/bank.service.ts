import { Injectable } from '@nestjs/common';
import { isUniqueViolation, type Prisma, type TenantTransaction } from '@smart-hr/database';
import { AppError, NotFoundError } from '@smart-hr/shared';
import { autoMatch, bankDedupeKeys, candidatesFor, type MatchCandidate } from '@smart-hr/validation';
import type { bankImportSchema } from '@smart-hr/validation';
import type { z } from 'zod';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { toDate } from '../employees/employees.service.js';
import { BooksService } from './books.service.js';
import { toPaise, toRupees } from './ledger-calc.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | number | null | undefined) =>
  d === null || d === undefined ? null : Number(d);
const n0 = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const SUGGEST_WINDOW_DAYS = 5;
const AUTO_WINDOW_DAYS = 3;

const BOOK_INCLUDE = {
  entry: { select: { id: true, number: true, date: true, narration: true, source: true } },
} satisfies Prisma.JournalLineInclude;
type BookLine = Prisma.JournalLineGetPayload<{ include: typeof BOOK_INCLUDE }>;

const presentBook = (l: BookLine) => ({
  journalLineId: l.id,
  entryId: l.entry.id,
  entryNumber: l.entry.number,
  date: iso(l.entry.date),
  narration: l.narration ?? l.entry.narration,
  source: l.entry.source,
  debit: n0(l.debit),
  credit: n0(l.credit),
});

/**
 * Bank reconciliation: a bank statement is imported for one bank account of a company and each of its lines is
 * matched to the posted journal line on that account for the same amount and direction (a deposit to a debit, a
 * withdrawal to a credit). Nothing in the books is changed by matching; a line with no entry yet is found by
 * posting the missing journal (for example bank charges) and matching it.
 */
@Injectable()
export class BankService {
  constructor(private readonly books: BooksService) {}

  private run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return this.books.run(tenant, auth, work);
  }

  private async bankAccount(tx: TenantTransaction, companyId: string, accountId: string) {
    const account = await tx.ledgerAccount.findUnique({ where: { id: accountId } });
    if (!account || account.companyId !== companyId) throw new NotFoundError('Account');
    if (account.type !== 'ASSET') {
      throw new AppError(
        'NOT_A_BANK_ACCOUNT',
        'Only an asset account (such as a bank account) can be reconciled',
        422,
      );
    }
    return account;
  }

  /** Accounts that can be reconciled: the company's asset accounts, bank first. */
  async accounts(tenant: TenantContext, auth: AuthContext, companyId: string) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, companyId, 'finance.view');
      const chart = await this.books.chartIn(tx, tenant.id, companyId);
      return chart
        .filter((a) => a.type === 'ASSET' && a.status === 'ACTIVE')
        .sort(
          (a, b) =>
            Number(b.systemKey === 'BANK') - Number(a.systemKey === 'BANK') || a.code.localeCompare(b.code),
        )
        .map((a) => ({ id: a.id, code: a.code, name: a.name, isBank: a.systemKey === 'BANK' }));
    });
  }

  async importStatement(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof bankImportSchema>,
    meta: RequestMeta,
  ) {
    try {
      return await this.run(tenant, auth, async (tx) => {
        await this.books.assertCompany(tx, tenant, input.companyId, 'finance.manage');
        await this.bankAccount(tx, input.companyId, input.accountId);
        const keys = bankDedupeKeys(
          input.lines.map((l) => ({
            date: l.date,
            description: l.description,
            reference: l.reference ?? null,
            deposit: l.deposit,
            withdrawal: l.withdrawal,
            balance: l.balance ?? null,
          })),
        );
        const existing = new Set(
          (
            await tx.bankStatementLine.findMany({
              where: { accountId: input.accountId, dedupeKey: { in: keys } },
              select: { dedupeKey: true },
            })
          ).map((r) => r.dedupeKey),
        );
        const fresh = input.lines.map((l, i) => ({ l, key: keys[i]! })).filter((x) => !existing.has(x.key));
        const duplicates = input.lines.length - fresh.length;
        if (fresh.length === 0) {
          throw new AppError('ALREADY_IMPORTED', 'Every line of this statement was imported before', 409);
        }
        const dates = fresh.map((x) => x.l.date).sort();
        const statement = await tx.bankStatement.create({
          data: {
            tenantId: tenant.id,
            companyId: input.companyId,
            accountId: input.accountId,
            fileName: input.fileName,
            periodFrom: toDate(dates[0]!),
            periodTo: toDate(dates[dates.length - 1]!),
            openingBalance: input.openingBalance ?? null,
            closingBalance: input.closingBalance ?? null,
            lineCount: fresh.length,
            importedByUserId: auth.user.id,
          },
        });
        await tx.bankStatementLine.createMany({
          data: fresh.map(({ l, key }) => ({
            tenantId: tenant.id,
            statementId: statement.id,
            companyId: input.companyId,
            accountId: input.accountId,
            date: toDate(l.date),
            description: l.description,
            reference: l.reference ?? null,
            deposit: l.deposit,
            withdrawal: l.withdrawal,
            balance: l.balance ?? null,
            dedupeKey: key,
          })),
        });
        await this.books.record(
          tx,
          tenant,
          auth,
          'finance.bank.import',
          'bank_statement',
          statement.id,
          meta,
          {
            lines: fresh.length,
            duplicates,
          },
        );
        return { statementId: statement.id, imported: fresh.length, duplicates };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(
          'ALREADY_IMPORTED',
          'Another import added some of these lines a moment ago. Try again.',
          409,
        );
      }
      throw error;
    }
  }

  async statements(tenant: TenantContext, auth: AuthContext, companyId: string, accountId: string) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, companyId, 'finance.view');
      await this.bankAccount(tx, companyId, accountId);
      const rows = await tx.bankStatement.findMany({
        where: { accountId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return rows.map((s) => ({
        id: s.id,
        fileName: s.fileName,
        periodFrom: iso(s.periodFrom),
        periodTo: iso(s.periodTo),
        openingBalance: num(s.openingBalance),
        closingBalance: num(s.closingBalance),
        lineCount: s.lineCount,
        importedAt: s.createdAt.toISOString(),
      }));
    });
  }

  /** Posted journal lines on the account that no statement line has taken yet. */
  private unmatchedBook(tx: TenantTransaction, accountId: string, from?: Date, to?: Date) {
    return tx.journalLine.findMany({
      where: {
        accountId,
        bankLine: null,
        entry: {
          status: 'POSTED',
          ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        },
      },
      include: BOOK_INCLUDE,
      orderBy: [{ entry: { date: 'asc' } }, { id: 'asc' }],
      take: 5000,
    });
  }

  async lines(
    tenant: TenantContext,
    auth: AuthContext,
    q: {
      companyId: string;
      accountId: string;
      status?: 'UNMATCHED' | 'MATCHED' | 'IGNORED' | undefined;
      from?: string | undefined;
      to?: string | undefined;
    },
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, q.companyId, 'finance.view');
      await this.bankAccount(tx, q.companyId, q.accountId);
      const rows = await tx.bankStatementLine.findMany({
        where: {
          accountId: q.accountId,
          ...(q.status ? { status: q.status } : {}),
          ...(q.from || q.to
            ? { date: { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) } }
            : {}),
        },
        include: { journalLine: { include: BOOK_INCLUDE } },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: 2000,
      });
      const open = rows.filter((r) => r.status === 'UNMATCHED');
      let pool: BookLine[] = [];
      if (open.length > 0) {
        const dates = open.map((r) => r.date.getTime());
        pool = await this.unmatchedBook(
          tx,
          q.accountId,
          addDays(new Date(Math.min(...dates)), -SUGGEST_WINDOW_DAYS),
          addDays(new Date(Math.max(...dates)), SUGGEST_WINDOW_DAYS),
        );
      }
      const candidates: MatchCandidate[] = pool.map((l) => ({
        id: l.id,
        date: iso(l.entry.date),
        debit: n0(l.debit),
        credit: n0(l.credit),
      }));
      const byId = new Map(pool.map((l) => [l.id, l]));
      return rows.map((r) => ({
        id: r.id,
        statementId: r.statementId,
        date: iso(r.date),
        description: r.description,
        reference: r.reference,
        deposit: n0(r.deposit),
        withdrawal: n0(r.withdrawal),
        balance: num(r.balance),
        status: r.status,
        note: r.note,
        matchedAt: r.matchedAt?.toISOString() ?? null,
        match: r.journalLine ? presentBook(r.journalLine) : null,
        suggestions:
          r.status === 'UNMATCHED'
            ? candidatesFor(
                { id: r.id, date: iso(r.date), deposit: n0(r.deposit), withdrawal: n0(r.withdrawal) },
                candidates,
                SUGGEST_WINDOW_DAYS,
              )
                .slice(0, 3)
                .map((c) => presentBook(byId.get(c.id)!))
            : [],
      }));
    });
  }

  /** Entries in the books that are not on the statement (cheques not cleared, deposits in transit, missing lines). */
  async bookItems(
    tenant: TenantContext,
    auth: AuthContext,
    companyId: string,
    accountId: string,
    to?: string,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, companyId, 'finance.view');
      await this.bankAccount(tx, companyId, accountId);
      return (await this.unmatchedBook(tx, accountId, undefined, to ? toDate(to) : undefined)).map(
        presentBook,
      );
    });
  }

  private async loadLine(tx: TenantTransaction, tenant: TenantContext, id: string) {
    const line = await tx.bankStatementLine.findUnique({ where: { id } });
    if (!line) throw new NotFoundError('Statement line');
    await this.books.assertCompany(tx, tenant, line.companyId, 'finance.manage');
    return line;
  }

  async match(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    journalLineId: string,
    meta: RequestMeta,
  ) {
    try {
      return await this.run(tenant, auth, async (tx) => {
        const line = await this.loadLine(tx, tenant, id);
        if (line.status !== 'UNMATCHED') {
          throw new AppError('INVALID_TRANSITION', 'This line is already matched or set aside', 409);
        }
        const book = await tx.journalLine.findUnique({ where: { id: journalLineId }, include: BOOK_INCLUDE });
        if (!book || book.accountId !== line.accountId) throw new NotFoundError('Journal line');
        const full = await tx.journalEntry.findUnique({
          where: { id: book.entry.id },
          select: { status: true },
        });
        if (full?.status !== 'POSTED') {
          throw new AppError('NOT_POSTED', 'Only a posted journal can be matched', 422);
        }
        if (
          toPaise(n0(book.debit)) !== toPaise(n0(line.deposit)) ||
          toPaise(n0(book.credit)) !== toPaise(n0(line.withdrawal))
        ) {
          throw new AppError(
            'AMOUNT_MISMATCH',
            'The amount or direction is different: a deposit matches a debit to the bank account, a withdrawal a credit',
            422,
          );
        }
        if (await tx.bankStatementLine.findFirst({ where: { journalLineId }, select: { id: true } })) {
          throw new AppError(
            'ALREADY_MATCHED',
            'That journal line is already matched to another statement line',
            409,
          );
        }
        await tx.bankStatementLine.update({
          where: { id },
          data: { status: 'MATCHED', journalLineId, matchedByUserId: auth.user.id, matchedAt: new Date() },
        });
        await this.books.record(tx, tenant, auth, 'finance.bank.match', 'bank_statement_line', id, meta, {
          journalLineId,
        });
        return { id, status: 'MATCHED' as const };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(
          'ALREADY_MATCHED',
          'That journal line is already matched to another statement line',
          409,
        );
      }
      throw error;
    }
  }

  /** Returns a matched or set-aside line to the unmatched list. */
  async unmatch(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const line = await this.loadLine(tx, tenant, id);
      if (line.status === 'UNMATCHED') return { id, status: 'UNMATCHED' as const };
      await tx.bankStatementLine.update({
        where: { id },
        data: {
          status: 'UNMATCHED',
          journalLineId: null,
          matchedByUserId: null,
          matchedAt: null,
          note: null,
        },
      });
      await this.books.record(tx, tenant, auth, 'finance.bank.unmatch', 'bank_statement_line', id, meta, {
        was: line.status,
      });
      return { id, status: 'UNMATCHED' as const };
    });
  }

  /** Sets a statement line aside (for example a bank error that was reversed), with a note. */
  async ignore(tenant: TenantContext, auth: AuthContext, id: string, note: string | null, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const line = await this.loadLine(tx, tenant, id);
      if (line.status !== 'UNMATCHED') {
        throw new AppError('INVALID_TRANSITION', 'Only an unmatched line can be set aside', 409);
      }
      await tx.bankStatementLine.update({
        where: { id },
        data: { status: 'IGNORED', note, matchedByUserId: auth.user.id, matchedAt: new Date() },
      });
      await this.books.record(tx, tenant, auth, 'finance.bank.ignore', 'bank_statement_line', id, meta);
      return { id, status: 'IGNORED' as const };
    });
  }

  /** Matches every statement line that has exactly one possible entry and no rival. */
  async autoMatch(
    tenant: TenantContext,
    auth: AuthContext,
    companyId: string,
    accountId: string,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, companyId, 'finance.manage');
      await this.bankAccount(tx, companyId, accountId);
      const open = await tx.bankStatementLine.findMany({
        where: { accountId, status: 'UNMATCHED' },
        take: 5000,
      });
      if (open.length === 0) return { matched: 0, remaining: 0 };
      const dates = open.map((r) => r.date.getTime());
      const pool = await this.unmatchedBook(
        tx,
        accountId,
        addDays(new Date(Math.min(...dates)), -AUTO_WINDOW_DAYS),
        addDays(new Date(Math.max(...dates)), AUTO_WINDOW_DAYS),
      );
      const pairs = autoMatch(
        open.map((r) => ({
          id: r.id,
          date: iso(r.date),
          deposit: n0(r.deposit),
          withdrawal: n0(r.withdrawal),
        })),
        pool.map((l) => ({ id: l.id, date: iso(l.entry.date), debit: n0(l.debit), credit: n0(l.credit) })),
        AUTO_WINDOW_DAYS,
      );
      const now = new Date();
      for (const [lineId, journalLineId] of pairs) {
        await tx.bankStatementLine.update({
          where: { id: lineId },
          data: { status: 'MATCHED', journalLineId, matchedByUserId: auth.user.id, matchedAt: now },
        });
      }
      await this.books.record(
        tx,
        tenant,
        auth,
        'finance.bank.auto_match',
        'ledger_account',
        accountId,
        meta,
        {
          matched: pairs.size,
        },
      );
      return { matched: pairs.size, remaining: open.length - pairs.size };
    });
  }

  /**
   * Where the reconciliation stands on a date. The adjusted bank balance is the statement balance plus
   * deposits the bank has not yet shown, less payments it has not yet cleared; the adjusted book balance is the
   * books plus bank items not yet booked (interest) less bank charges not yet booked. Both should agree.
   */
  async summary(
    tenant: TenantContext,
    auth: AuthContext,
    companyId: string,
    accountId: string,
    asOf?: string,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, companyId, 'finance.view');
      const account = await this.bankAccount(tx, companyId, accountId);
      const to = asOf ? toDate(asOf) : new Date();
      const agg = await tx.journalLine.aggregate({
        where: { accountId, entry: { status: 'POSTED', date: { lte: to } } },
        _sum: { debit: true, credit: true },
      });
      const book = toRupees(toPaise(n0(agg._sum.debit)) - toPaise(n0(agg._sum.credit)));
      const statement = await tx.bankStatement.findFirst({
        where: { accountId, periodTo: { lte: to }, closingBalance: { not: null } },
        orderBy: [{ periodTo: 'desc' }, { createdAt: 'desc' }],
      });
      const bankOnly = await tx.bankStatementLine.findMany({
        where: { accountId, status: 'UNMATCHED', date: { lte: to } },
        select: { deposit: true, withdrawal: true },
      });
      const bookOnly = await this.unmatchedBook(tx, accountId, undefined, to);
      const sum = (rows: number[]) => toRupees(rows.reduce((s, v) => s + toPaise(v), 0));
      const bankDeposits = sum(bankOnly.map((r) => n0(r.deposit)));
      const bankWithdrawals = sum(bankOnly.map((r) => n0(r.withdrawal)));
      const inTransit = sum(bookOnly.map((l) => n0(l.debit)));
      const uncleared = sum(bookOnly.map((l) => n0(l.credit)));
      const statementBalance = statement ? num(statement.closingBalance) : null;
      const adjustedBank =
        statementBalance === null
          ? null
          : toRupees(toPaise(statementBalance) + toPaise(inTransit) - toPaise(uncleared));
      const adjustedBook = toRupees(toPaise(book) + toPaise(bankDeposits) - toPaise(bankWithdrawals));
      const counts = await tx.bankStatementLine.groupBy({
        by: ['status'],
        where: { accountId, date: { lte: to } },
        _count: { _all: true },
      });
      return {
        account: { id: account.id, code: account.code, name: account.name },
        asOf: iso(to),
        bookBalance: book,
        statementBalance,
        statementDate: statement ? iso(statement.periodTo) : null,
        bankOnly: { count: bankOnly.length, deposits: bankDeposits, withdrawals: bankWithdrawals },
        bookOnly: { count: bookOnly.length, inTransit, uncleared },
        adjustedBank,
        adjustedBook,
        difference: adjustedBank === null ? null : toRupees(toPaise(adjustedBank) - toPaise(adjustedBook)),
        reconciled: adjustedBank !== null && toPaise(adjustedBank) === toPaise(adjustedBook),
        lines: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      };
    });
  }
}
