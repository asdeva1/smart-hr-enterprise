import { Injectable } from '@nestjs/common';
import type { Prisma } from '@smart-hr/database';
import { AppError } from '@smart-hr/shared';
import {
  computeSalesTotals,
  parseGstr2b,
  reconcileGstr2b,
  type BookRow,
  type gstPeriodQuerySchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { toDate } from '../employees/employees.service.js';
import { BooksService } from './books.service.js';
import { toPaise, toRupees } from './ledger-calc.js';

type Period = z.output<typeof gstPeriodQuerySchema>;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | number | null | undefined) =>
  d === null || d === undefined ? 0 : Number(d);
/** A B2C invoice above this value, made to another state, is reported invoice by invoice (B2CL). */
const B2CL_LIMIT = 250_000;

interface Tax {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}
const zero = (): Tax => ({ taxable: 0, cgst: 0, sgst: 0, igst: 0 });
/** Add (or with sign -1 subtract) in paise so the totals never drift. */
function add(into: Tax, t: Tax, sign: 1 | -1 = 1) {
  into.taxable = toRupees(toPaise(into.taxable) + sign * toPaise(t.taxable));
  into.cgst = toRupees(toPaise(into.cgst) + sign * toPaise(t.cgst));
  into.sgst = toRupees(toPaise(into.sgst) + sign * toPaise(t.sgst));
  into.igst = toRupees(toPaise(into.igst) + sign * toPaise(t.igst));
}

const SALES_DONE = ['ISSUED', 'PARTIALLY_PAID', 'PAID'] as const;
const BILL_DONE = ['POSTED', 'PARTIALLY_PAID', 'PAID'] as const;

/**
 * GST and TDS returns data worked out from the posted invoices, credit notes, bills and debit notes: the
 * GSTR-1 sections, a GSTR-3B style summary, the purchase register, GSTR-2B reconciliation and the TDS report.
 * Everything is read-only; nothing here changes the books.
 */
@Injectable()
export class GstService {
  constructor(private readonly books: BooksService) {}

  private async seller(tx: Parameters<Parameters<BooksService['run']>[2]>[0], companyId: string) {
    const s = await tx.salesSetting.findFirst({ where: { companyId } });
    return { gstin: s?.gstin ?? null, stateCode: s?.stateCode ?? null };
  }

  async gstr1(tenant: TenantContext, auth: AuthContext, q: Period) {
    return this.books.run(tenant, auth, async (tx) => {
      const seller = await this.seller(tx, q.companyId);
      const docs = await tx.salesDocument.findMany({
        where: {
          companyId: q.companyId,
          type: { in: ['INVOICE', 'CREDIT_NOTE'] },
          status: { in: [...SALES_DONE] },
          date: { gte: toDate(q.from), lte: toDate(q.to) },
        },
        include: { customer: true, lines: { orderBy: { position: 'asc' } } },
        orderBy: [{ date: 'asc' }, { number: 'asc' }],
      });
      const relatedIds = docs.filter((d) => d.relatedId).map((d) => d.relatedId!);
      const related = relatedIds.length
        ? await tx.salesDocument.findMany({
            where: { id: { in: relatedIds } },
            select: { id: true, number: true, date: true, total: true },
          })
        : [];
      const relatedById = new Map(related.map((r) => [r.id, r]));

      const b2b: unknown[] = [];
      const b2cl: unknown[] = [];
      const cdnr: unknown[] = [];
      const cdnur: unknown[] = [];
      const b2cs = new Map<string, Tax & { pos: string | null; rate: number }>();
      const hsn = new Map<
        string,
        Tax & { hsn: string; rate: number; unit: string | null; quantity: number; value: number }
      >();
      const totals = { invoices: zero(), creditNotes: zero() };
      const missingHsn: string[] = [];

      for (const d of docs) {
        const credit = d.type === 'CREDIT_NOTE';
        const sign = credit ? -1 : 1;
        const intra = num(d.igst) === 0;
        // Tax by rate, from the lines, so each rate can be reported on its own.
        const rates = new Map<number, Tax>();
        for (const l of d.lines) {
          const calc = computeSalesTotals(
            [
              {
                quantity: num(l.quantity),
                rate: num(l.rate),
                discountPct: num(l.discountPct),
                gstRate: num(l.gstRate),
              },
            ],
            intra,
          );
          const t: Tax = { taxable: calc.subtotal, cgst: calc.cgst, sgst: calc.sgst, igst: calc.igst };
          const rate = num(l.gstRate);
          const at = rates.get(rate) ?? zero();
          add(at, t);
          rates.set(rate, at);
          const key = `${l.hsn ?? ''}|${rate}|${l.unit ?? ''}`;
          const h = hsn.get(key) ?? {
            ...zero(),
            hsn: l.hsn ?? '',
            rate,
            unit: l.unit ?? null,
            quantity: 0,
            value: 0,
          };
          add(h, t, sign);
          h.quantity += sign * num(l.quantity);
          h.value = toRupees(
            toPaise(h.value) + sign * (toPaise(t.taxable) + toPaise(t.cgst + t.sgst + t.igst)),
          );
          hsn.set(key, h);
          if (!l.hsn && !missingHsn.includes(d.number ?? d.id)) missingHsn.push(d.number ?? d.id);
        }
        const docTax: Tax = {
          taxable: num(d.subtotal),
          cgst: num(d.cgst),
          sgst: num(d.sgst),
          igst: num(d.igst),
        };
        add(credit ? totals.creditNotes : totals.invoices, docTax);
        const registered = !!d.customer.gstin;
        const pos = d.placeOfSupply ?? d.customer.stateCode ?? null;
        const base = {
          id: d.id,
          number: d.number,
          date: iso(d.date),
          customer: d.customer.name,
          gstin: d.customer.gstin,
          placeOfSupply: pos,
          ...docTax,
          total: num(d.total),
          rates: [...rates.entries()].map(([rate, t]) => ({ rate, ...t })),
        };
        const rel = d.relatedId ? relatedById.get(d.relatedId) : undefined;
        const interState = !!seller.stateCode && !!pos && seller.stateCode !== pos;
        if (!credit && registered) b2b.push(base);
        else if (!credit && interState && num(d.total) > B2CL_LIMIT) b2cl.push(base);
        else if (credit && registered)
          cdnr.push({ ...base, against: rel ? { number: rel.number, date: iso(rel.date) } : null });
        else if (credit && interState && rel && num(rel.total) > B2CL_LIMIT)
          cdnur.push({ ...base, against: { number: rel.number, date: iso(rel.date) } });
        else {
          // Small sales to consumers are only totalled by state and rate; credit notes reduce them.
          for (const [rate, t] of rates) {
            const key = `${pos ?? ''}|${rate}`;
            const row = b2cs.get(key) ?? { ...zero(), pos, rate };
            add(row, t, sign);
            b2cs.set(key, row);
          }
        }
      }
      const net = zero();
      add(net, totals.invoices);
      add(net, totals.creditNotes, -1);
      return {
        period: { from: q.from, to: q.to },
        seller,
        b2b,
        b2cl,
        b2cs: [...b2cs.values()],
        cdnr,
        cdnur,
        hsn: [...hsn.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate),
        totals: { invoices: totals.invoices, creditNotes: totals.creditNotes, net },
        warnings: {
          sellerGstinMissing: !seller.gstin,
          documentsWithoutHsn: missingHsn,
        },
      };
    });
  }

  /** Posted bills and debit notes in the period, with the input GST on each. */
  private async purchaseRows(tx: Parameters<Parameters<BooksService['run']>[2]>[0], q: Period) {
    return tx.purchaseBill.findMany({
      where: {
        companyId: q.companyId,
        status: { in: [...BILL_DONE] },
        date: { gte: toDate(q.from), lte: toDate(q.to) },
      },
      include: { vendor: true },
      orderBy: [{ date: 'asc' }, { number: 'asc' }],
    });
  }

  async purchaseRegister(tenant: TenantContext, auth: AuthContext, q: Period) {
    return this.books.run(tenant, auth, async (tx) => {
      const rows = await this.purchaseRows(tx, q);
      const totals = zero();
      const out = rows.map((b) => {
        const sign = b.type === 'DEBIT_NOTE' ? -1 : 1;
        const t: Tax = { taxable: num(b.subtotal), cgst: num(b.cgst), sgst: num(b.sgst), igst: num(b.igst) };
        add(totals, t, sign);
        return {
          id: b.id,
          type: b.type,
          number: b.number,
          vendorBillNo: b.vendorBillNo,
          date: iso(b.date),
          vendor: b.vendor.name,
          gstin: b.vendor.gstin,
          ...t,
          total: num(b.total),
        };
      });
      return { period: { from: q.from, to: q.to }, rows: out, totals };
    });
  }

  /** Output tax less input tax credit for the period, head by head. */
  async gstr3b(tenant: TenantContext, auth: AuthContext, q: Period) {
    const sales = await this.gstr1(tenant, auth, q);
    const purchases = await this.purchaseRegister(tenant, auth, q);
    const output = sales.totals.net;
    const itc = purchases.totals;
    const heads = (['igst', 'cgst', 'sgst'] as const).map((h) => ({
      head: h,
      output: output[h],
      itc: itc[h],
      payable: toRupees(toPaise(output[h]) - toPaise(itc[h])),
    }));
    return {
      period: sales.period,
      outward: { taxable: output.taxable, ...Object.fromEntries(heads.map((h) => [h.head, h.output])) },
      itc: { taxable: itc.taxable, ...Object.fromEntries(heads.map((h) => [h.head, h.itc])) },
      heads,
      netPayable: toRupees(heads.reduce((s, h) => s + toPaise(h.payable), 0)),
      note: 'A negative amount is credit carried forward. IGST credit is used before CGST and SGST when you file; that set-off is not applied here.',
    };
  }

  /** Match the books against a GSTR-2B file. Nothing is saved. */
  async reconcile(tenant: TenantContext, auth: AuthContext, q: Period & { data: unknown }) {
    let portal;
    try {
      portal = parseGstr2b(q.data);
    } catch (e) {
      throw new AppError('INVALID_GSTR2B', e instanceof Error ? e.message : 'Could not read the file', 422);
    }
    return this.books.run(tenant, auth, async (tx) => {
      const bills = (await this.purchaseRows(tx, q)).filter((b) => b.type === 'BILL');
      const withGstin = bills.filter((b) => b.vendor.gstin && b.vendorBillNo);
      const books: BookRow[] = withGstin.map((b) => ({
        id: b.id,
        gstin: b.vendor.gstin!,
        supplier: b.vendor.name,
        number: b.vendorBillNo!,
        date: iso(b.date),
        taxable: num(b.subtotal),
        cgst: num(b.cgst),
        sgst: num(b.sgst),
        igst: num(b.igst),
      }));
      // The portal file covers a return month, so invoices dated outside the range are not "missing".
      const inRange = portal.filter((p) => !p.date || (p.date >= q.from && p.date <= q.to));
      const rows = reconcileGstr2b(books, inRange);
      const count = (s: string) => rows.filter((r) => r.status === s).length;
      return {
        period: { from: q.from, to: q.to },
        rows,
        counts: {
          matched: count('MATCHED'),
          mismatch: count('MISMATCH'),
          missingInBooks: count('MISSING_IN_BOOKS'),
          missingIn2b: count('MISSING_IN_2B'),
        },
        skipped: {
          billsWithoutGstinOrNumber: bills.length - withGstin.length,
        },
      };
    });
  }

  /** Tax deducted at source on vendor bills, by vendor and rate. */
  async tds(tenant: TenantContext, auth: AuthContext, q: Period) {
    return this.books.run(tenant, auth, async (tx) => {
      const rows = (await this.purchaseRows(tx, q)).filter((b) => num(b.tdsAmount) > 0);
      const by = new Map<
        string,
        {
          vendor: { id: string; name: string; pan: string | null };
          rate: number;
          base: number;
          tds: number;
          bills: number;
        }
      >();
      let total = 0;
      const detail = rows.map((b) => {
        const sign = b.type === 'DEBIT_NOTE' ? -1 : 1;
        const rate = num(b.tdsRate);
        const key = `${b.vendorId}|${rate}`;
        const row = by.get(key) ?? {
          vendor: { id: b.vendor.id, name: b.vendor.name, pan: b.vendor.pan },
          rate,
          base: 0,
          tds: 0,
          bills: 0,
        };
        row.base = toRupees(toPaise(row.base) + sign * toPaise(num(b.subtotal)));
        row.tds = toRupees(toPaise(row.tds) + sign * toPaise(num(b.tdsAmount)));
        row.bills += 1;
        by.set(key, row);
        total += sign * toPaise(num(b.tdsAmount));
        return {
          id: b.id,
          type: b.type,
          number: b.number,
          date: iso(b.date),
          vendor: b.vendor.name,
          pan: b.vendor.pan,
          rate,
          base: num(b.subtotal),
          tds: num(b.tdsAmount),
        };
      });
      return {
        period: { from: q.from, to: q.to },
        rows: [...by.values()].sort((a, b) => a.vendor.name.localeCompare(b.vendor.name)),
        detail,
        total: toRupees(total),
        vendorsWithoutPan: [...by.values()].filter((r) => !r.vendor.pan).map((r) => r.vendor.name),
      };
    });
  }
}
