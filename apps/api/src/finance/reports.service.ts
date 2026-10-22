import { Injectable } from '@nestjs/common';
import type { Prisma, TenantTransaction } from '@smart-hr/database';
import { NotFoundError } from '@smart-hr/shared';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { toDate } from '../employees/employees.service.js';
import { BooksService } from './books.service.js';
import {
  balanceSheet,
  ledger,
  openingBalance,
  profitAndLoss,
  trialBalance,
  type AccountRef,
  type PostedLine,
} from './ledger-calc.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Financial reports from posted journals only. */
@Injectable()
export class ReportsService {
  constructor(private readonly books: BooksService) {}

  private async lines(tx: TenantTransaction, companyId: string, where: Prisma.JournalEntryWhereInput) {
    const rows = await tx.journalLine.findMany({
      where: { entry: { companyId, status: 'POSTED', ...where } },
      select: { id: true, accountId: true, debit: true, credit: true, entry: { select: { date: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      date: iso(r.entry.date),
      debit: Number(r.debit),
      credit: Number(r.credit),
    }));
  }

  private async accounts(tx: TenantTransaction, tenantId: string, companyId: string): Promise<AccountRef[]> {
    return (await this.books.chartIn(tx, tenantId, companyId)).map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
    }));
  }

  async trialBalance(tenant: TenantContext, auth: AuthContext, companyId: string, asOf: string) {
    return this.books.run(tenant, auth, async (tx) => {
      const company = await this.books.assertCompany(tx, tenant, companyId, 'finance.view');
      const lines = await this.lines(tx, companyId, { date: { lte: toDate(asOf) } });
      return { company, asOf, ...trialBalance(await this.accounts(tx, tenant.id, companyId), lines) };
    });
  }

  async profitAndLoss(tenant: TenantContext, auth: AuthContext, companyId: string, from: string, to: string) {
    return this.books.run(tenant, auth, async (tx) => {
      const company = await this.books.assertCompany(tx, tenant, companyId, 'finance.view');
      const lines = await this.lines(tx, companyId, { date: { gte: toDate(from), lte: toDate(to) } });
      return { company, from, to, ...profitAndLoss(await this.accounts(tx, tenant.id, companyId), lines) };
    });
  }

  async balanceSheet(tenant: TenantContext, auth: AuthContext, companyId: string, asOf: string) {
    return this.books.run(tenant, auth, async (tx) => {
      const company = await this.books.assertCompany(tx, tenant, companyId, 'finance.view');
      const lines = await this.lines(tx, companyId, { date: { lte: toDate(asOf) } });
      return { company, asOf, ...balanceSheet(await this.accounts(tx, tenant.id, companyId), lines) };
    });
  }

  /** One account's lines in a period with opening and running balances. */
  async ledger(tenant: TenantContext, auth: AuthContext, accountId: string, from: string, to: string) {
    return this.books.run(tenant, auth, async (tx) => {
      const account = await tx.ledgerAccount.findUnique({ where: { id: accountId } });
      if (!account) throw new NotFoundError('Account');
      await this.books.assertCompany(tx, tenant, account.companyId, 'finance.view');
      const before: PostedLine[] = (
        await tx.journalLine.findMany({
          where: { accountId, entry: { status: 'POSTED', date: { lt: toDate(from) } } },
          select: { debit: true, credit: true, entry: { select: { date: true } } },
        })
      ).map((r) => ({
        accountId,
        date: iso(r.entry.date),
        debit: Number(r.debit),
        credit: Number(r.credit),
      }));
      const rows = await tx.journalLine.findMany({
        where: { accountId, entry: { status: 'POSTED', date: { gte: toDate(from), lte: toDate(to) } } },
        select: {
          id: true,
          debit: true,
          credit: true,
          narration: true,
          entry: { select: { id: true, number: true, date: true, narration: true } },
        },
        orderBy: [{ entry: { date: 'asc' } }, { entry: { number: 'asc' } }],
      });
      const result = ledger(
        account.type,
        openingBalance(account.type, before),
        rows.map((r) => ({
          id: r.id,
          accountId,
          date: iso(r.entry.date),
          debit: Number(r.debit),
          credit: Number(r.credit),
        })),
      );
      const byId = new Map(rows.map((r) => [r.id, r]));
      return {
        account: { id: account.id, code: account.code, name: account.name, type: account.type },
        from,
        to,
        opening: result.opening,
        closing: result.closing,
        rows: result.rows.map((r) => {
          const src = byId.get(r.id)!;
          return {
            ...r,
            journal: { id: src.entry.id, number: src.entry.number },
            narration: src.narration ?? src.entry.narration,
          };
        }),
      };
    });
  }

  /** Every posted journal in a period, oldest first, with its lines: the day book. */
  async dayBook(tenant: TenantContext, auth: AuthContext, companyId: string, from: string, to: string) {
    return this.books.run(tenant, auth, async (tx) => {
      const company = await this.books.assertCompany(tx, tenant, companyId, 'finance.view');
      const entries = await tx.journalEntry.findMany({
        where: { companyId, status: 'POSTED', date: { gte: toDate(from), lte: toDate(to) } },
        orderBy: [{ date: 'asc' }, { number: 'asc' }],
        take: 2000,
        select: {
          id: true,
          number: true,
          date: true,
          narration: true,
          source: true,
          total: true,
          lines: {
            orderBy: { position: 'asc' },
            select: {
              id: true,
              debit: true,
              credit: true,
              narration: true,
              account: { select: { code: true, name: true } },
            },
          },
        },
      });
      const rows = entries.map((e) => ({
        id: e.id,
        number: e.number,
        date: iso(e.date),
        narration: e.narration,
        source: e.source,
        total: Number(e.total),
        lines: e.lines.map((l) => ({
          id: l.id,
          account: `${l.account.code} · ${l.account.name}`,
          debit: Number(l.debit),
          credit: Number(l.credit),
          narration: l.narration,
        })),
      }));
      return { company, from, to, rows, total: rows.reduce((s, r) => s + r.total, 0) };
    });
  }

  /** The ledgers of the cash and bank accounts: the cash book and bank book. */
  async cashBook(
    tenant: TenantContext,
    auth: AuthContext,
    companyId: string,
    from: string,
    to: string,
    kind: 'CASH' | 'BANK' | 'ALL',
  ) {
    const accounts = await this.books.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, companyId, 'finance.view');
      const chart = await this.books.chartIn(tx, tenant.id, companyId);
      return chart.filter(
        (a) =>
          a.status === 'ACTIVE' &&
          a.systemKey !== null &&
          (kind === 'ALL' ? ['CASH', 'BANK'].includes(a.systemKey) : a.systemKey === kind),
      );
    });
    const books = [];
    for (const a of accounts) books.push(await this.ledger(tenant, auth, a.id, from, to));
    return { from, to, books };
  }
}
