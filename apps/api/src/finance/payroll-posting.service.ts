import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { PayrollRun, TenantTransaction } from '@smart-hr/database';
import { hasFeature } from '@smart-hr/entitlements';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import type { Line } from '../payroll/payroll-calc.js';
import { PayrollEvents } from '../payroll/payroll-events.js';
import { periodLabel } from '../payroll/payroll-runs.service.js';
import { toPaise, toRupees } from './ledger-calc.js';
import { BooksService } from './books.service.js';

const PF_LINES = new Set(['PF']);
const PF_EMPLOYER = new Set(['EPF_ER', 'EPS', 'EDLI', 'PF_ADMIN']);

/**
 * Posts payroll to the books when the organisation's plan includes finance: the salary cost and what is
 * owed (net pay, PF, ESI, professional tax, TDS, other deductions) when a run is approved, and the payment
 * from the bank when it is marked paid. Both happen in the same transaction as the payroll step.
 */
@Injectable()
export class PayrollPostingService implements OnModuleInit {
  constructor(
    private readonly events: PayrollEvents,
    private readonly books: BooksService,
    private readonly entitlements: EntitlementsService,
  ) {}

  onModuleInit(): void {
    this.events.onApproved((tx, run, actor) => this.accrue(tx, run, actor));
    this.events.onPaid((tx, run, actor) => this.pay(tx, run, actor));
  }

  private async enabled(tx: TenantTransaction) {
    return hasFeature(await this.entitlements.forTenant(tx), 'finance');
  }

  async accrue(tx: TenantTransaction, run: PayrollRun, actor: string | null) {
    if (!(await this.enabled(tx))) return;
    const payslips = await tx.payslip.findMany({
      where: { runId: run.id },
      select: { gross: true, net: true, deductions: true, employer: true },
    });
    const sum = { gross: 0, net: 0, pfEe: 0, esiEe: 0, pt: 0, tds: 0, other: 0, pfEr: 0, esiEr: 0 };
    for (const p of payslips) {
      sum.gross += toPaise(Number(p.gross));
      sum.net += toPaise(Number(p.net));
      for (const d of p.deductions as unknown as Line[]) {
        const a = toPaise(d.amount);
        if (PF_LINES.has(d.code)) sum.pfEe += a;
        else if (d.code === 'ESI') sum.esiEe += a;
        else if (d.code === 'PT') sum.pt += a;
        else if (d.code === 'TDS') sum.tds += a;
        else sum.other += a;
      }
      for (const e of p.employer as unknown as Line[]) {
        const a = toPaise(e.amount);
        if (PF_EMPLOYER.has(e.code)) sum.pfEr += a;
        else if (e.code === 'ESI_ER') sum.esiEr += a;
      }
    }
    const r = toRupees;
    const label = periodLabel(run.year, run.month);
    await this.books.postSystem(tx, {
      tenantId: run.tenantId,
      companyId: run.companyId,
      date: new Date(Date.UTC(run.year, run.month, 0)),
      narration: `Payroll for ${label}`,
      source: 'PAYROLL',
      sourceId: run.id,
      createdByUserId: actor ?? run.createdByUserId,
      lines: [
        { systemKey: 'SALARY_EXPENSE', debit: r(sum.gross), credit: 0, narration: 'Gross pay' },
        {
          systemKey: 'STATUTORY_EXPENSE',
          debit: r(sum.pfEr + sum.esiEr),
          credit: 0,
          narration: 'Employer PF and ESI',
        },
        { systemKey: 'SALARY_PAYABLE', debit: 0, credit: r(sum.net), narration: 'Net pay owed' },
        {
          systemKey: 'PF_PAYABLE',
          debit: 0,
          credit: r(sum.pfEe + sum.pfEr),
          narration: 'Employee and employer PF',
        },
        {
          systemKey: 'ESI_PAYABLE',
          debit: 0,
          credit: r(sum.esiEe + sum.esiEr),
          narration: 'Employee and employer ESI',
        },
        { systemKey: 'PT_PAYABLE', debit: 0, credit: r(sum.pt) },
        { systemKey: 'TDS_PAYABLE', debit: 0, credit: r(sum.tds) },
        { systemKey: 'OTHER_DEDUCTIONS_PAYABLE', debit: 0, credit: r(sum.other) },
      ],
    });
  }

  async pay(tx: TenantTransaction, run: PayrollRun, actor: string | null) {
    if (!(await this.enabled(tx))) return;
    const net = toRupees(toPaise(Number(run.net)));
    if (net <= 0) return;
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    await this.books.postSystem(tx, {
      tenantId: run.tenantId,
      companyId: run.companyId,
      date: today,
      narration: `Salaries paid for ${periodLabel(run.year, run.month)}`,
      source: 'PAYROLL_PAYMENT',
      sourceId: run.id,
      createdByUserId: actor ?? run.createdByUserId,
      lines: [
        { systemKey: 'SALARY_PAYABLE', debit: net, credit: 0 },
        { systemKey: 'BANK', debit: 0, credit: net },
      ],
    });
  }
}
