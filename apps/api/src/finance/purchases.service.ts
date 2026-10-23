import { Injectable } from '@nestjs/common';
import type { Prisma, TenantTransaction } from '@smart-hr/database';
import { AppError, NotFoundError, type Permission } from '@smart-hr/shared';
import { computeSalesTotals, stateOfGstin } from '@smart-hr/validation';
import type { z } from 'zod';
import type { billListSchema, billSchema, updateBillSchema, vendorPaymentSchema } from '@smart-hr/validation';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { toDate } from '../employees/employees.service.js';
import { financialYearOf } from '../payroll/statutory-in.js';
import { BooksService } from './books.service.js';
import { toPaise, toRupees } from './ledger-calc.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | number | null | undefined) =>
  d === null || d === undefined ? 0 : Number(d);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const PREFIX = { BILL: 'BILL', DEBIT_NOTE: 'DN' } as const;
type BillStatus = 'DRAFT' | 'POSTED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';

const BILL_INCLUDE = {
  lines: { orderBy: { position: 'asc' as const } },
  vendor: true,
} satisfies Prisma.PurchaseBillInclude;
type BillRow = Prisma.PurchaseBillGetPayload<{ include: typeof BILL_INCLUDE }>;

/** TDS on the taxable value, rounded to the paisa. */
const tdsOf = (subtotal: number, rate: number) => toRupees(Math.round((toPaise(subtotal) * rate) / 100));
/** What we actually owe the vendor on a bill: the total less TDS held back. */
const payable = (total: number, tds: number) => toRupees(toPaise(total) - toPaise(tds));
const settledStatus = (due: number, settled: number): BillStatus =>
  toPaise(settled) >= toPaise(due) ? 'PAID' : toPaise(settled) > 0 ? 'PARTIALLY_PAID' : 'POSTED';

/**
 * Purchases and payables: vendor bills with input GST and TDS, debit notes, and payments to vendors. Posting a
 * bill or debit note and recording a payment post to the books straight away; posted bills are corrected with
 * a debit note, never edited.
 */
@Injectable()
export class PurchasesService {
  constructor(private readonly books: BooksService) {}

  private run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return this.books.run(tenant, auth, work);
  }

  private async nextNumber(
    tx: TenantTransaction,
    companyId: string,
    prefix: string,
    date: Date,
    table: 'bill' | 'payment',
  ) {
    const fy = financialYearOf(date.getUTCFullYear(), date.getUTCMonth() + 1);
    const full = `${prefix}/${fy}/`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`purchase-number:${companyId}:${full}`}))`;
    const where = { companyId, number: { startsWith: full } };
    const last =
      table === 'bill'
        ? await tx.purchaseBill.findFirst({ where, orderBy: { number: 'desc' }, select: { number: true } })
        : await tx.vendorPayment.findFirst({ where, orderBy: { number: 'desc' }, select: { number: true } });
    const next = (last?.number ? Number(last.number.slice(full.length)) : 0) + 1;
    return `${full}${String(next).padStart(4, '0')}`;
  }

  private async present(tx: TenantTransaction, b: BillRow) {
    const accountIds = [...new Set(b.lines.map((l) => l.accountId))];
    const accounts = await tx.ledgerAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, code: true, name: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const total = num(b.total);
    const tds = num(b.tdsAmount);
    const due = payable(total, tds);
    const open = b.status === 'POSTED' || b.status === 'PARTIALLY_PAID';
    return {
      id: b.id,
      companyId: b.companyId,
      type: b.type,
      number: b.number,
      vendorBillNo: b.vendorBillNo,
      status: b.status,
      date: iso(b.date),
      dueDate: b.dueDate ? iso(b.dueDate) : null,
      placeOfSupply: b.placeOfSupply,
      note: b.note,
      subtotal: num(b.subtotal),
      cgst: num(b.cgst),
      sgst: num(b.sgst),
      igst: num(b.igst),
      total,
      tdsRate: num(b.tdsRate),
      tdsAmount: tds,
      payable: due,
      settled: num(b.settled),
      outstanding: b.type === 'BILL' && open ? toRupees(toPaise(due) - toPaise(num(b.settled))) : 0,
      relatedId: b.relatedId,
      journalEntryId: b.journalEntryId,
      vendor: {
        id: b.vendor.id,
        name: b.vendor.name,
        code: b.vendor.code,
        gstin: b.vendor.gstin,
        address: b.vendor.address,
      },
      lines: b.lines.map((l) => ({
        id: l.id,
        description: l.description,
        hsn: l.hsn,
        quantity: num(l.quantity),
        rate: num(l.rate),
        gstRate: num(l.gstRate),
        amount: num(l.amount),
        accountId: l.accountId,
        account: byId.get(l.accountId) ?? null,
      })),
    };
  }

  private async load(tx: TenantTransaction, tenant: TenantContext, id: string, code: Permission) {
    const b = await tx.purchaseBill.findUnique({ where: { id }, include: BILL_INCLUDE });
    if (!b) throw new NotFoundError('Bill');
    await this.books.assertCompany(tx, tenant, b.companyId, code);
    return b;
  }

  private async prepare(
    tx: TenantTransaction,
    companyId: string,
    type: 'BILL' | 'DEBIT_NOTE',
    input: z.output<typeof updateBillSchema>,
  ) {
    const vendor = await tx.vendor.findUnique({ where: { id: input.vendorId } });
    if (!vendor || vendor.status !== 'ACTIVE') {
      throw new AppError('VALIDATION_FAILED', 'Choose an active vendor', 400, [
        { path: 'vendorId', message: 'Choose an active vendor' },
      ]);
    }
    const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
    const accounts = await tx.ledgerAccount.findMany({
      where: { id: { in: accountIds }, companyId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (accounts.length !== accountIds.length) {
      throw new AppError('VALIDATION_FAILED', 'Use active accounts of this company', 400, [
        { path: 'lines', message: 'Unknown account' },
      ]);
    }
    if (type === 'DEBIT_NOTE') {
      const bill = input.relatedId
        ? await tx.purchaseBill.findUnique({ where: { id: input.relatedId } })
        : null;
      if (
        !bill ||
        bill.type !== 'BILL' ||
        bill.companyId !== companyId ||
        bill.vendorId !== vendor.id ||
        bill.status === 'DRAFT' ||
        bill.status === 'CANCELLED'
      ) {
        throw new AppError(
          'VALIDATION_FAILED',
          'A debit note corrects a posted bill from the same vendor',
          400,
          [{ path: 'relatedId', message: 'Choose the bill this corrects' }],
        );
      }
    }
    const setting = await tx.salesSetting.findUnique({ where: { companyId } });
    const buyerState = setting?.stateCode ?? null;
    const pos = input.placeOfSupply ?? stateOfGstin(vendor.gstin);
    // Within the buyer's state tax is CGST + SGST; otherwise IGST. Unknown states are treated as local.
    const intra = !buyerState || !pos || buyerState === pos;
    const totals = computeSalesTotals(
      input.lines.map((l) => ({ quantity: l.quantity, rate: l.rate, discountPct: 0, gstRate: l.gstRate })),
      intra,
    );
    return { vendor, pos, totals, tds: tdsOf(totals.subtotal, input.tdsRate) };
  }

  private lineRows(
    tenantId: string,
    billId: string,
    input: z.output<typeof updateBillSchema>,
    amounts: number[],
  ) {
    return input.lines.map((l, i) => ({
      tenantId,
      billId,
      position: i + 1,
      description: l.description,
      hsn: l.hsn ?? null,
      quantity: l.quantity,
      rate: l.rate,
      gstRate: l.gstRate,
      accountId: l.accountId,
      amount: amounts[i]!,
    }));
  }

  async createBill(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof billSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, input.companyId, 'finance.manage');
      const { vendor, pos, totals, tds } = await this.prepare(tx, input.companyId, input.type, input);
      const bill = await tx.purchaseBill.create({
        data: {
          tenantId: tenant.id,
          companyId: input.companyId,
          vendorId: vendor.id,
          type: input.type,
          vendorBillNo: input.vendorBillNo ?? null,
          date: toDate(input.date),
          dueDate: input.dueDate ? toDate(input.dueDate) : null,
          placeOfSupply: pos,
          note: input.note ?? null,
          relatedId: input.relatedId ?? null,
          subtotal: totals.subtotal,
          cgst: totals.cgst,
          sgst: totals.sgst,
          igst: totals.igst,
          total: totals.total,
          tdsRate: input.tdsRate,
          tdsAmount: tds,
          createdByUserId: auth.user.id,
        },
      });
      await tx.purchaseBillLine.createMany({
        data: this.lineRows(
          tenant.id,
          bill.id,
          input,
          totals.lines.map((l) => l.amount),
        ),
      });
      await this.books.record(tx, tenant, auth, 'purchases.bill.create', 'purchase_bill', bill.id, meta, {
        type: input.type,
      });
      return this.present(
        tx,
        await tx.purchaseBill.findUniqueOrThrow({ where: { id: bill.id }, include: BILL_INCLUDE }),
      );
    });
  }

  async updateBill(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateBillSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const b = await this.load(tx, tenant, id, 'finance.manage');
      if (b.status !== 'DRAFT') throw new AppError('DOCUMENT_LOCKED', 'Only drafts can be edited', 409);
      const { vendor, pos, totals, tds } = await this.prepare(tx, b.companyId, b.type, input);
      await tx.purchaseBillLine.deleteMany({ where: { billId: id } });
      await tx.purchaseBillLine.createMany({
        data: this.lineRows(
          tenant.id,
          id,
          input,
          totals.lines.map((l) => l.amount),
        ),
      });
      await tx.purchaseBill.update({
        where: { id },
        data: {
          vendorId: vendor.id,
          vendorBillNo: input.vendorBillNo ?? null,
          date: toDate(input.date),
          dueDate: input.dueDate ? toDate(input.dueDate) : null,
          placeOfSupply: pos,
          note: input.note ?? null,
          relatedId: input.relatedId ?? b.relatedId,
          subtotal: totals.subtotal,
          cgst: totals.cgst,
          sgst: totals.sgst,
          igst: totals.igst,
          total: totals.total,
          tdsRate: input.tdsRate,
          tdsAmount: tds,
        },
      });
      await this.books.record(tx, tenant, auth, 'purchases.bill.update', 'purchase_bill', id, meta);
      return this.present(
        tx,
        await tx.purchaseBill.findUniqueOrThrow({ where: { id }, include: BILL_INCLUDE }),
      );
    });
  }

  async bill(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) =>
      this.present(tx, await this.load(tx, tenant, id, 'finance.view')),
    );
  }

  async bills(tenant: TenantContext, auth: AuthContext, q: z.output<typeof billListSchema>) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, q.companyId, 'finance.view');
      const today = toDate(iso(new Date()));
      const where: Prisma.PurchaseBillWhereInput = { companyId: q.companyId, type: q.type };
      if (q.vendorId) where.vendorId = q.vendorId;
      if (q.status === 'OPEN') where.status = { in: ['POSTED', 'PARTIALLY_PAID'] };
      else if (q.status === 'OVERDUE') {
        where.status = { in: ['POSTED', 'PARTIALLY_PAID'] };
        where.dueDate = { lt: today };
      } else if (q.status !== 'ALL') where.status = q.status;
      if (q.q) {
        where.OR = [
          { number: { contains: q.q, mode: 'insensitive' } },
          { vendorBillNo: { contains: q.q, mode: 'insensitive' } },
          { vendor: { name: { contains: q.q, mode: 'insensitive' } } },
        ];
      }
      const rows = await tx.purchaseBill.findMany({
        where,
        include: { vendor: { select: { id: true, name: true } } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 300,
      });
      return rows.map((r) => {
        const open = r.status === 'POSTED' || r.status === 'PARTIALLY_PAID';
        const due = payable(num(r.total), num(r.tdsAmount));
        return {
          id: r.id,
          number: r.number,
          vendorBillNo: r.vendorBillNo,
          type: r.type,
          status: r.status,
          date: iso(r.date),
          dueDate: r.dueDate ? iso(r.dueDate) : null,
          overdue: !!r.dueDate && r.dueDate < today && open && r.type === 'BILL',
          vendor: r.vendor,
          total: num(r.total),
          tdsAmount: num(r.tdsAmount),
          outstanding: r.type === 'BILL' && open ? toRupees(toPaise(due) - toPaise(num(r.settled))) : 0,
        };
      });
    });
  }

  /** Post a draft bill or debit note to the books. */
  async post(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const b = await this.load(tx, tenant, id, 'finance.manage');
      if (b.status !== 'DRAFT') throw new AppError('DOCUMENT_LOCKED', 'This is already posted', 409);
      const total = num(b.total);
      if (toPaise(total) === 0) throw new AppError('EMPTY_DOCUMENT', 'The total is zero', 409);
      const hasTax = toPaise(num(b.cgst) + num(b.sgst) + num(b.igst)) > 0;
      const setting = await tx.salesSetting.findUnique({ where: { companyId: b.companyId } });
      if (hasTax && !setting?.stateCode) {
        throw new AppError(
          'SELLER_STATE_MISSING',
          'Add your GSTIN or state under Business details before posting a bill with GST',
          409,
        );
      }
      const tds = num(b.tdsAmount);
      const type = b.type;
      if (type === 'DEBIT_NOTE') {
        const bill = await tx.purchaseBill.findUnique({ where: { id: b.relatedId ?? '' } });
        const room = bill
          ? toPaise(payable(num(bill.total), num(bill.tdsAmount))) - toPaise(num(bill.settled))
          : 0;
        if (!bill || toPaise(payable(total, tds)) > room) {
          throw new AppError(
            'CREDIT_TOO_LARGE',
            'A debit note can’t be more than what is still owed on the bill',
            409,
          );
        }
      }
      await this.books.ensureSystemAccounts(tx, tenant.id, b.companyId);
      const number = await this.nextNumber(tx, b.companyId, PREFIX[type], b.date, 'bill');
      // A bill debits expenses and input GST and credits what we owe; a debit note is the reverse.
      const debitSide = type === 'BILL';
      const side = (amount: number) => ({ debit: debitSide ? amount : 0, credit: debitSide ? 0 : amount });
      const opposite = (amount: number) => ({
        debit: debitSide ? 0 : amount,
        credit: debitSide ? amount : 0,
      });
      const perAccount = new Map<string, number>();
      for (const l of b.lines) {
        perAccount.set(l.accountId, (perAccount.get(l.accountId) ?? 0) + toPaise(num(l.amount)));
      }
      const ref = `${number} · ${b.vendor.name}`;
      const entry = await this.books.postSystem(tx, {
        tenantId: tenant.id,
        companyId: b.companyId,
        date: b.date,
        narration: `${type === 'BILL' ? 'Bill' : 'Debit note'} ${number} · ${b.vendor.name}`,
        source: 'PURCHASE_BILL',
        sourceId: b.id,
        createdByUserId: auth.user.id,
        lines: [
          ...[...perAccount].map(([accountId, p]) => ({ accountId, ...side(toRupees(p)), narration: ref })),
          { systemKey: 'GST_IN_CGST', ...side(num(b.cgst)), narration: 'Input CGST' },
          { systemKey: 'GST_IN_SGST', ...side(num(b.sgst)), narration: 'Input SGST' },
          { systemKey: 'GST_IN_IGST', ...side(num(b.igst)), narration: 'Input IGST' },
          { systemKey: 'PAYABLES', ...opposite(payable(total, tds)), narration: ref },
          { systemKey: 'TDS_VENDOR_PAYABLE', ...opposite(tds), narration: 'TDS held back' },
        ],
      });
      let status: BillStatus = 'POSTED';
      let settled = 0;
      let dueDate = b.dueDate;
      if (type === 'BILL') {
        dueDate = dueDate ?? addDays(b.date, b.vendor.paymentTermsDays);
      } else {
        const bill = await tx.purchaseBill.findUniqueOrThrow({ where: { id: b.relatedId! } });
        const s = toRupees(toPaise(num(bill.settled)) + toPaise(payable(total, tds)));
        await tx.purchaseBill.update({
          where: { id: bill.id },
          data: { settled: s, status: settledStatus(payable(num(bill.total), num(bill.tdsAmount)), s) },
        });
        status = 'PAID';
        settled = payable(total, tds);
      }
      await tx.purchaseBill.update({
        where: { id },
        data: { number, status, settled, dueDate, journalEntryId: entry.id, postedAt: new Date() },
      });
      await this.books.record(tx, tenant, auth, 'purchases.bill.post', 'purchase_bill', id, meta, { number });
      return this.present(
        tx,
        await tx.purchaseBill.findUniqueOrThrow({ where: { id }, include: BILL_INCLUDE }),
      );
    });
  }

  async cancel(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const b = await this.load(tx, tenant, id, 'finance.manage');
      if (b.status !== 'DRAFT') {
        throw new AppError(
          'DOCUMENT_LOCKED',
          'A posted bill is corrected with a debit note, not cancelled',
          409,
        );
      }
      await tx.purchaseBill.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.books.record(tx, tenant, auth, 'purchases.bill.cancel', 'purchase_bill', id, meta);
      return this.present(
        tx,
        await tx.purchaseBill.findUniqueOrThrow({ where: { id }, include: BILL_INCLUDE }),
      );
    });
  }

  /** A new draft debit note copied from a posted bill. */
  async debitNote(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const b = await this.load(tx, tenant, id, 'finance.manage');
      if (b.type !== 'BILL' || b.status === 'DRAFT' || b.status === 'CANCELLED') {
        throw new AppError('NOT_ALLOWED', 'A debit note corrects a posted bill', 409);
      }
      const dn = await tx.purchaseBill.create({
        data: {
          tenantId: tenant.id,
          companyId: b.companyId,
          vendorId: b.vendorId,
          type: 'DEBIT_NOTE',
          vendorBillNo: null,
          date: toDate(iso(new Date())),
          placeOfSupply: b.placeOfSupply,
          note: b.note,
          relatedId: b.id,
          subtotal: b.subtotal,
          cgst: b.cgst,
          sgst: b.sgst,
          igst: b.igst,
          total: b.total,
          tdsRate: b.tdsRate,
          tdsAmount: b.tdsAmount,
          createdByUserId: auth.user.id,
        },
      });
      await tx.purchaseBillLine.createMany({
        data: b.lines.map((l) => ({
          tenantId: tenant.id,
          billId: dn.id,
          position: l.position,
          description: l.description,
          hsn: l.hsn,
          quantity: l.quantity,
          rate: l.rate,
          gstRate: l.gstRate,
          accountId: l.accountId,
          amount: l.amount,
        })),
      });
      await this.books.record(tx, tenant, auth, 'purchases.bill.debit-note', 'purchase_bill', dn.id, meta);
      return this.present(
        tx,
        await tx.purchaseBill.findUniqueOrThrow({ where: { id: dn.id }, include: BILL_INCLUDE }),
      );
    });
  }

  // ---- Payments -----------------------------------------------------------------------------------

  async payments(tenant: TenantContext, auth: AuthContext, companyId: string, vendorId?: string) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, companyId, 'finance.view');
      const rows = await tx.vendorPayment.findMany({
        where: { companyId, ...(vendorId ? { vendorId } : {}) },
        include: {
          vendor: { select: { id: true, name: true } },
          allocations: { include: { bill: { select: { number: true } } } },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 300,
      });
      return rows.map((r) => ({
        id: r.id,
        number: r.number,
        date: iso(r.date),
        vendor: r.vendor,
        amount: num(r.amount),
        mode: r.mode,
        reference: r.reference,
        allocations: r.allocations.map((a) => ({
          billId: a.billId,
          number: a.bill.number,
          amount: num(a.amount),
        })),
        unallocated: toRupees(
          toPaise(num(r.amount)) - r.allocations.reduce((s, a) => s + toPaise(num(a.amount)), 0),
        ),
      }));
    });
  }

  async recordPayment(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof vendorPaymentSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, input.companyId, 'finance.manage');
      const vendor = await tx.vendor.findUnique({ where: { id: input.vendorId } });
      if (!vendor) throw new NotFoundError('Vendor');
      const source = await tx.ledgerAccount.findFirst({
        where: { id: input.paidFromAccountId, companyId: input.companyId, status: 'ACTIVE', type: 'ASSET' },
      });
      if (!source) {
        throw new AppError('VALIDATION_FAILED', 'Choose a bank or cash account of this company', 400, [
          { path: 'paidFromAccountId', message: 'Choose a bank or cash account' },
        ]);
      }
      const date = toDate(input.date);
      const amount = toPaise(input.amount);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vendor-payment:${input.vendorId}`}))`;
      const open = await tx.purchaseBill.findMany({
        where: {
          companyId: input.companyId,
          vendorId: input.vendorId,
          type: 'BILL',
          status: { in: ['POSTED', 'PARTIALLY_PAID'] },
        },
        orderBy: [{ dueDate: 'asc' }, { date: 'asc' }],
      });
      const room = new Map(
        open.map((o) => [o.id, toPaise(payable(num(o.total), num(o.tdsAmount))) - toPaise(num(o.settled))]),
      );
      let plan: { billId: string; amount: number }[];
      if (input.allocations) {
        plan = input.allocations.map((a) => ({ billId: a.billId, amount: toPaise(a.amount) }));
        for (const a of plan) {
          if (!room.has(a.billId) || a.amount > room.get(a.billId)!) {
            throw new AppError(
              'OVER_ALLOCATED',
              'A bill is paid more than it is owed, or isn’t open for this vendor',
              400,
            );
          }
        }
        if (plan.reduce((s, a) => s + a.amount, 0) > amount) {
          throw new AppError('OVER_ALLOCATED', 'The bills add up to more than the amount paid', 400);
        }
      } else {
        let left = amount;
        plan = [];
        for (const o of open) {
          if (left <= 0) break;
          const take = Math.min(left, room.get(o.id)!);
          if (take > 0) plan.push({ billId: o.id, amount: take });
          left -= take;
        }
      }
      const number = await this.nextNumber(tx, input.companyId, 'PAY', date, 'payment');
      await this.books.ensureSystemAccounts(tx, tenant.id, input.companyId);
      const payment = await tx.vendorPayment.create({
        data: {
          tenantId: tenant.id,
          companyId: input.companyId,
          vendorId: input.vendorId,
          number,
          date,
          amount: input.amount,
          mode: input.mode,
          reference: input.reference ?? null,
          note: input.note ?? null,
          paidFromAccountId: source.id,
          createdByUserId: auth.user.id,
        },
      });
      for (const a of plan) {
        await tx.paymentAllocation.create({
          data: { tenantId: tenant.id, paymentId: payment.id, billId: a.billId, amount: toRupees(a.amount) },
        });
        const bill = open.find((o) => o.id === a.billId)!;
        const settled = toRupees(toPaise(num(bill.settled)) + a.amount);
        await tx.purchaseBill.update({
          where: { id: bill.id },
          data: { settled, status: settledStatus(payable(num(bill.total), num(bill.tdsAmount)), settled) },
        });
      }
      const entry = await this.books.postSystem(tx, {
        tenantId: tenant.id,
        companyId: input.companyId,
        date,
        narration: `Payment ${number} · ${vendor.name}`,
        source: 'VENDOR_PAYMENT',
        sourceId: payment.id,
        createdByUserId: auth.user.id,
        lines: [
          { systemKey: 'PAYABLES', debit: input.amount, credit: 0, narration: vendor.name },
          {
            accountId: source.id,
            debit: 0,
            credit: input.amount,
            ...(input.reference ? { narration: input.reference } : {}),
          },
        ],
      });
      await tx.vendorPayment.update({ where: { id: payment.id }, data: { journalEntryId: entry.id } });
      await this.books.record(
        tx,
        tenant,
        auth,
        'purchases.payment.create',
        'vendor_payment',
        payment.id,
        meta,
        {
          number,
          amount: input.amount,
        },
      );
      return {
        id: payment.id,
        number,
        amount: input.amount,
        allocated: toRupees(plan.reduce((s, a) => s + a.amount, 0)),
      };
    });
  }

  // ---- Reports ------------------------------------------------------------------------------------

  async summary(tenant: TenantContext, auth: AuthContext, companyId: string) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, companyId, 'finance.view');
      const today = toDate(iso(new Date()));
      const weekEnd = addDays(today, 7);
      const monthStart = toDate(`${iso(new Date()).slice(0, 8)}01`);
      const open = await tx.purchaseBill.findMany({
        where: { companyId, type: 'BILL', status: { in: ['POSTED', 'PARTIALLY_PAID'] } },
        select: { total: true, tdsAmount: true, settled: true, dueDate: true },
      });
      let outstanding = 0;
      let overdue = 0;
      let overdueCount = 0;
      let dueSoon = 0;
      for (const o of open) {
        const owed = toPaise(payable(num(o.total), num(o.tdsAmount))) - toPaise(num(o.settled));
        outstanding += owed;
        if (o.dueDate && o.dueDate < today) {
          overdue += owed;
          overdueCount += 1;
        } else if (o.dueDate && o.dueDate <= weekEnd) dueSoon += owed;
      }
      const paid = await tx.vendorPayment.aggregate({
        where: { companyId, date: { gte: monthStart } },
        _sum: { amount: true },
        _count: true,
      });
      const drafts = await tx.purchaseBill.count({ where: { companyId, type: 'BILL', status: 'DRAFT' } });
      return {
        outstanding: toRupees(outstanding),
        outstandingCount: open.length,
        overdue: toRupees(overdue),
        overdueCount,
        dueThisWeek: toRupees(dueSoon),
        paidThisMonth: num(paid._sum.amount),
        paidCount: paid._count,
        drafts,
      };
    });
  }

  async ageing(tenant: TenantContext, auth: AuthContext, companyId: string, asOf?: string) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, companyId, 'finance.view');
      const day = asOf ?? iso(new Date());
      const ref = toDate(day).getTime();
      const rows = await tx.purchaseBill.findMany({
        where: { companyId, type: 'BILL', status: { in: ['POSTED', 'PARTIALLY_PAID'] } },
        include: { vendor: { select: { id: true, name: true } } },
      });
      const KEYS = ['current', 'd1to30', 'd31to60', 'd61to90', 'over90'] as const;
      type Row = { vendor: { id: string; name: string } } & Record<(typeof KEYS)[number] | 'total', number>;
      const by = new Map<string, Row>();
      for (const r of rows) {
        const owed = toPaise(payable(num(r.total), num(r.tdsAmount))) - toPaise(num(r.settled));
        const late = r.dueDate ? Math.floor((ref - r.dueDate.getTime()) / 86_400_000) : 0;
        const k = KEYS[late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4];
        const row = by.get(r.vendorId) ?? {
          vendor: r.vendor,
          current: 0,
          d1to30: 0,
          d31to60: 0,
          d61to90: 0,
          over90: 0,
          total: 0,
        };
        row[k] += owed;
        row.total += owed;
        by.set(r.vendorId, row);
      }
      const list = [...by.values()]
        .map((r) => ({
          vendor: r.vendor,
          current: toRupees(r.current),
          d1to30: toRupees(r.d1to30),
          d31to60: toRupees(r.d31to60),
          d61to90: toRupees(r.d61to90),
          over90: toRupees(r.over90),
          total: toRupees(r.total),
        }))
        .sort((a, b) => b.total - a.total);
      const sum = (k: (typeof KEYS)[number] | 'total') =>
        toRupees(list.reduce((s, r) => s + toPaise(r[k]), 0));
      return {
        asOf: day,
        rows: list,
        totals: {
          current: sum('current'),
          d1to30: sum('d1to30'),
          d31to60: sum('d31to60'),
          d61to90: sum('d61to90'),
          over90: sum('over90'),
          total: sum('total'),
        },
      };
    });
  }

  /** A vendor's ledger: bills raised, debit notes and payments, with what is owed after each. */
  async statement(
    tenant: TenantContext,
    auth: AuthContext,
    vendorId: string,
    companyId: string,
    from: string,
    to: string,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, companyId, 'finance.view');
      const vendor = await tx.vendor.findUnique({ where: { id: vendorId } });
      if (!vendor) throw new NotFoundError('Vendor');
      const docs = await tx.purchaseBill.findMany({
        where: { companyId, vendorId, status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] } },
        select: { id: true, number: true, type: true, date: true, total: true, tdsAmount: true },
      });
      const pays = await tx.vendorPayment.findMany({
        where: { companyId, vendorId },
        select: { id: true, number: true, date: true, amount: true },
      });
      type Entry = {
        id: string;
        date: string;
        kind: 'BILL' | 'DEBIT_NOTE' | 'PAYMENT';
        number: string | null;
        billed: number;
        paid: number;
      };
      const entries: Entry[] = [
        ...docs.map((d) => {
          const net = payable(num(d.total), num(d.tdsAmount));
          return {
            id: d.id,
            date: iso(d.date),
            kind: d.type,
            number: d.number,
            billed: d.type === 'BILL' ? net : 0,
            paid: d.type === 'DEBIT_NOTE' ? net : 0,
          };
        }),
        ...pays.map((p) => ({
          id: p.id,
          date: iso(p.date),
          kind: 'PAYMENT' as const,
          number: p.number,
          billed: 0,
          paid: num(p.amount),
        })),
      ].sort((a, b) => a.date.localeCompare(b.date) || (a.number ?? '').localeCompare(b.number ?? ''));
      let opening = 0;
      for (const e of entries.filter((x) => x.date < from)) opening += toPaise(e.billed) - toPaise(e.paid);
      let bal = opening;
      const rows = entries
        .filter((x) => x.date >= from && x.date <= to)
        .map((e) => {
          bal += toPaise(e.billed) - toPaise(e.paid);
          return { ...e, balance: toRupees(bal) };
        });
      return {
        vendor: { id: vendor.id, name: vendor.name, gstin: vendor.gstin },
        from,
        to,
        opening: toRupees(opening),
        closing: toRupees(bal),
        rows,
      };
    });
  }
}
