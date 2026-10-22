import { Injectable } from '@nestjs/common';
import type { Prisma, TenantTransaction } from '@smart-hr/database';
import { AppError, NotFoundError, type Permission } from '@smart-hr/shared';
import { amountInWords, computeSalesTotals, stateOfGstin } from '@smart-hr/validation';
import type { z } from 'zod';
import type {
  customerSchema,
  receiptSchema,
  salesDocumentListSchema,
  salesDocumentSchema,
  salesSettingSchema,
  templateSchema,
  updateCustomerSchema,
  updateSalesDocumentSchema,
  updateTemplateSchema,
} from '@smart-hr/validation';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import { toDate } from '../employees/employees.service.js';
import { financialYearOf } from '../payroll/statutory-in.js';
import { BooksService } from './books.service.js';
import { toPaise, toRupees } from './ledger-calc.js';

/** Drops undefined keys so partial inputs satisfy strict optional property types. */
const defined = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | number | null | undefined) =>
  d === null || d === undefined ? 0 : Number(d);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

const PREFIX = {
  INVOICE: 'INV',
  QUOTATION: 'QTN',
  PROFORMA: 'PI',
  CHALLAN: 'DC',
  CREDIT_NOTE: 'CN',
} as const;
type DocType = keyof typeof PREFIX;
type Status = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';

const DOC_INCLUDE = {
  lines: { orderBy: { position: 'asc' as const } },
  customer: true,
  template: true,
} satisfies Prisma.SalesDocumentInclude;
type DocRow = Prisma.SalesDocumentGetPayload<{ include: typeof DOC_INCLUDE }>;

const settledStatus = (total: number, settled: number): Status =>
  toPaise(settled) >= toPaise(total) ? 'PAID' : toPaise(settled) > 0 ? 'PARTIALLY_PAID' : 'ISSUED';

/**
 * Sales and receivables: customers, invoices (with GST), quotations, proformas, delivery challans, credit
 * notes and customer receipts. Issuing an invoice or credit note, and recording a receipt, post to the books
 * straight away; nothing posted is edited, only corrected by a credit note.
 */
@Injectable()
export class SalesService {
  constructor(private readonly books: BooksService) {}

  private run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return this.books.run(tenant, auth, work);
  }

  // ---- Customers ----------------------------------------------------------------------------------

  async customers(tenant: TenantContext, auth: AuthContext, q?: string) {
    return this.run(tenant, auth, async (tx) => {
      const rows = await tx.customer.findMany({
        where: q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { code: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {},
        orderBy: { name: 'asc' },
        take: 500,
      });
      return rows;
    });
  }

  async createCustomer(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof customerSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-code:${tenant.id}`}))`;
      const last = await tx.customer.findFirst({
        where: { code: { startsWith: 'CUS-' } },
        orderBy: { code: 'desc' },
        select: { code: true },
      });
      const next = (last ? Number(last.code.slice(4)) : 0) + 1;
      const c = await tx.customer.create({
        data: {
          tenantId: tenant.id,
          code: `CUS-${String(next).padStart(4, '0')}`,
          ...defined(input),
          stateCode: input.stateCode ?? stateOfGstin(input.gstin),
        },
      });
      await this.books.record(tx, tenant, auth, 'sales.customer.create', 'customer', c.id, meta);
      return c;
    });
  }

  async updateCustomer(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateCustomerSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const found = await tx.customer.findUnique({ where: { id } });
      if (!found) throw new NotFoundError('Customer');
      const c = await tx.customer.update({
        where: { id },
        data: {
          ...defined(input),
          ...(input.gstin && !input.stateCode ? { stateCode: stateOfGstin(input.gstin) } : {}),
        },
      });
      await this.books.record(tx, tenant, auth, 'sales.customer.update', 'customer', id, meta);
      return c;
    });
  }

  // ---- Templates and the seller's details ---------------------------------------------------------

  async templates(tenant: TenantContext, auth: AuthContext) {
    return this.run(tenant, auth, async (tx) => {
      const count = await tx.invoiceTemplate.count();
      if (count === 0) {
        await tx.invoiceTemplate.createMany({
          data: [
            { tenantId: tenant.id, name: 'Classic', layout: 'CLASSIC', accent: '#1d56c9', isDefault: true },
            { tenantId: tenant.id, name: 'Modern', layout: 'MODERN', accent: '#0f6b5c' },
            { tenantId: tenant.id, name: 'Minimal', layout: 'MINIMAL', accent: '#33424e', showUpi: false },
            { tenantId: tenant.id, name: 'Compact GST', layout: 'COMPACT_GST', accent: '#7a2e8e' },
          ],
          skipDuplicates: true,
        });
      }
      return tx.invoiceTemplate.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
    });
  }

  async createTemplate(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof templateSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const exists = await tx.invoiceTemplate.findFirst({ where: { name: input.name } });
      if (exists) throw new AppError('DUPLICATE', 'A template with this name already exists', 409);
      const t = await tx.invoiceTemplate.create({ data: { tenantId: tenant.id, ...defined(input) } });
      await this.books.record(tx, tenant, auth, 'sales.template.create', 'invoice_template', t.id, meta);
      return t;
    });
  }

  async updateTemplate(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateTemplateSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const found = await tx.invoiceTemplate.findUnique({ where: { id } });
      if (!found) throw new NotFoundError('Template');
      if (input.status === 'ARCHIVED' && found.isDefault) {
        throw new AppError('DEFAULT_TEMPLATE', 'Make another template the default first', 409);
      }
      const t = await tx.invoiceTemplate.update({ where: { id }, data: defined(input) });
      await this.books.record(tx, tenant, auth, 'sales.template.update', 'invoice_template', id, meta);
      return t;
    });
  }

  async makeDefaultTemplate(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const found = await tx.invoiceTemplate.findUnique({ where: { id } });
      if (!found || found.status !== 'ACTIVE') throw new NotFoundError('Template');
      await tx.invoiceTemplate.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      const t = await tx.invoiceTemplate.update({ where: { id }, data: { isDefault: true } });
      await this.books.record(tx, tenant, auth, 'sales.template.default', 'invoice_template', id, meta);
      return t;
    });
  }

  async settings(tenant: TenantContext, auth: AuthContext, companyId: string) {
    return this.run(tenant, auth, async (tx) => {
      const company = await this.books.assertCompany(tx, tenant, companyId, 'finance.view');
      const s = await tx.salesSetting.findUnique({ where: { companyId } });
      return { company, ...(s ?? {}) };
    });
  }

  async saveSettings(
    tenant: TenantContext,
    auth: AuthContext,
    companyId: string,
    input: z.output<typeof salesSettingSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, companyId, 'finance.configure');
      const data = { ...defined(input), stateCode: input.stateCode ?? stateOfGstin(input.gstin) };
      const s = await tx.salesSetting.upsert({
        where: { companyId },
        create: { tenantId: tenant.id, companyId, ...data },
        update: data,
      });
      await this.books.record(tx, tenant, auth, 'sales.settings.update', 'company', companyId, meta);
      return s;
    });
  }

  // ---- Documents ----------------------------------------------------------------------------------

  private async nextNumber(
    tx: TenantTransaction,
    companyId: string,
    prefix: string,
    date: Date,
    table: 'doc' | 'receipt',
  ) {
    const fy = financialYearOf(date.getUTCFullYear(), date.getUTCMonth() + 1);
    const full = `${prefix}/${fy}/`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sales-number:${companyId}:${full}`}))`;
    const last =
      table === 'doc'
        ? await tx.salesDocument.findFirst({
            where: { companyId, number: { startsWith: full } },
            orderBy: { number: 'desc' },
            select: { number: true },
          })
        : await tx.customerReceipt.findFirst({
            where: { companyId, number: { startsWith: full } },
            orderBy: { number: 'desc' },
            select: { number: true },
          });
    const next = (last?.number ? Number(last.number.slice(full.length)) : 0) + 1;
    return `${full}${String(next).padStart(4, '0')}`;
  }

  private async sellerState(tx: TenantTransaction, companyId: string) {
    const s = await tx.salesSetting.findUnique({ where: { companyId } });
    return { setting: s, state: s?.stateCode ?? null };
  }

  private async present(tx: TenantTransaction, d: DocRow) {
    const { setting } = await this.sellerState(tx, d.companyId);
    const company = await tx.company.findUnique({
      where: { id: d.companyId },
      select: { id: true, name: true, legalName: true },
    });
    const total = num(d.total);
    const settled = num(d.settled);
    return {
      id: d.id,
      companyId: d.companyId,
      company,
      seller: setting
        ? {
            gstin: setting.gstin,
            pan: setting.pan,
            stateCode: setting.stateCode,
            address: setting.address,
            bankName: setting.bankName,
            bankAccountNo: setting.bankAccountNo,
            bankIfsc: setting.bankIfsc,
            upiId: setting.upiId,
            signatory: setting.signatory,
          }
        : null,
      type: d.type,
      number: d.number,
      status: d.status,
      date: iso(d.date),
      dueDate: d.dueDate ? iso(d.dueDate) : null,
      poNumber: d.poNumber,
      placeOfSupply: d.placeOfSupply,
      note: d.note,
      terms: d.terms,
      subtotal: num(d.subtotal),
      cgst: num(d.cgst),
      sgst: num(d.sgst),
      igst: num(d.igst),
      total,
      settled,
      outstanding:
        d.type === 'INVOICE' && d.status !== 'DRAFT' && d.status !== 'CANCELLED'
          ? toRupees(toPaise(total) - toPaise(settled))
          : 0,
      amountInWords: amountInWords(total),
      relatedId: d.relatedId,
      journalEntryId: d.journalEntryId,
      customer: {
        id: d.customer.id,
        name: d.customer.name,
        gstin: d.customer.gstin,
        stateCode: d.customer.stateCode,
        billingAddress: d.customer.billingAddress,
        shippingAddress: d.customer.shippingAddress,
        email: d.customer.email,
      },
      template: d.template
        ? {
            id: d.template.id,
            name: d.template.name,
            layout: d.template.layout,
            accent: d.template.accent,
            showHsn: d.template.showHsn,
            showGstSplit: d.template.showGstSplit,
            showBank: d.template.showBank,
            showUpi: d.template.showUpi,
            showSignatory: d.template.showSignatory,
            showPo: d.template.showPo,
          }
        : null,
      lines: d.lines.map((l) => ({
        id: l.id,
        description: l.description,
        hsn: l.hsn,
        quantity: num(l.quantity),
        unit: l.unit,
        rate: num(l.rate),
        discountPct: num(l.discountPct),
        gstRate: num(l.gstRate),
        amount: num(l.amount),
      })),
    };
  }

  private async load(tx: TenantTransaction, tenant: TenantContext, id: string, code: Permission) {
    const d = await tx.salesDocument.findUnique({ where: { id }, include: DOC_INCLUDE });
    if (!d) throw new NotFoundError('Document');
    await this.books.assertCompany(tx, tenant, d.companyId, code);
    return d;
  }

  /** Customer, template and credit-note links checked, and the totals worked out. */
  private async prepare(
    tx: TenantTransaction,
    companyId: string,
    type: DocType,
    input: z.output<typeof updateSalesDocumentSchema>,
  ) {
    const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
    if (!customer || customer.status !== 'ACTIVE') {
      throw new AppError('VALIDATION_FAILED', 'Choose an active customer', 400, [
        { path: 'customerId', message: 'Choose an active customer' },
      ]);
    }
    if (input.templateId) {
      const t = await tx.invoiceTemplate.findUnique({ where: { id: input.templateId } });
      if (!t || t.status !== 'ACTIVE') {
        throw new AppError('VALIDATION_FAILED', 'Choose an active template', 400, [
          { path: 'templateId', message: 'Choose an active template' },
        ]);
      }
    }
    if (type === 'CREDIT_NOTE') {
      const inv = input.relatedId
        ? await tx.salesDocument.findUnique({ where: { id: input.relatedId } })
        : null;
      if (
        !inv ||
        inv.type !== 'INVOICE' ||
        inv.companyId !== companyId ||
        inv.customerId !== customer.id ||
        inv.status === 'DRAFT' ||
        inv.status === 'CANCELLED'
      ) {
        throw new AppError(
          'VALIDATION_FAILED',
          'A credit note corrects an issued invoice of the same customer',
          400,
          [{ path: 'relatedId', message: 'Choose the invoice this corrects' }],
        );
      }
    }
    const { state } = await this.sellerState(tx, companyId);
    const pos = input.placeOfSupply ?? customer.stateCode ?? null;
    const intra = !state || !pos || state === pos;
    const totals = computeSalesTotals(
      input.lines.map((l) => ({
        quantity: l.quantity,
        rate: l.rate,
        discountPct: l.discountPct,
        gstRate: l.gstRate,
      })),
      intra,
    );
    return { customer, pos, totals };
  }

  private lineRows(
    tenantId: string,
    documentId: string,
    input: z.output<typeof updateSalesDocumentSchema>,
    amounts: number[],
  ) {
    return input.lines.map((l, i) => ({
      tenantId,
      documentId,
      position: i + 1,
      description: l.description,
      hsn: l.hsn ?? null,
      quantity: l.quantity,
      unit: l.unit ?? null,
      rate: l.rate,
      discountPct: l.discountPct,
      gstRate: l.gstRate,
      amount: amounts[i]!,
    }));
  }

  async createDocument(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof salesDocumentSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, input.companyId, 'finance.manage');
      const { customer, pos, totals } = await this.prepare(tx, input.companyId, input.type, input);
      const template =
        input.templateId ??
        (await tx.invoiceTemplate.findFirst({ where: { isDefault: true, status: 'ACTIVE' } }))?.id ??
        null;
      const date = toDate(input.date);
      const doc = await tx.salesDocument.create({
        data: {
          tenantId: tenant.id,
          companyId: input.companyId,
          customerId: customer.id,
          templateId: template,
          type: input.type,
          date,
          dueDate: input.dueDate ? toDate(input.dueDate) : null,
          poNumber: input.poNumber ?? null,
          placeOfSupply: pos,
          note: input.note ?? null,
          terms: input.terms ?? null,
          relatedId: input.relatedId ?? null,
          subtotal: totals.subtotal,
          cgst: totals.cgst,
          sgst: totals.sgst,
          igst: totals.igst,
          total: totals.total,
          createdByUserId: auth.user.id,
        },
      });
      await tx.salesDocumentLine.createMany({
        data: this.lineRows(
          tenant.id,
          doc.id,
          input,
          totals.lines.map((l) => l.amount),
        ),
      });
      await this.books.record(tx, tenant, auth, 'sales.document.create', 'sales_document', doc.id, meta, {
        type: input.type,
      });
      return this.present(
        tx,
        await tx.salesDocument.findUniqueOrThrow({ where: { id: doc.id }, include: DOC_INCLUDE }),
      );
    });
  }

  async updateDocument(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateSalesDocumentSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const d = await this.load(tx, tenant, id, 'finance.manage');
      if (d.status !== 'DRAFT') throw new AppError('DOCUMENT_LOCKED', 'Only drafts can be edited', 409);
      const { customer, pos, totals } = await this.prepare(tx, d.companyId, d.type, input);
      await tx.salesDocumentLine.deleteMany({ where: { documentId: id } });
      await tx.salesDocumentLine.createMany({
        data: this.lineRows(
          tenant.id,
          id,
          input,
          totals.lines.map((l) => l.amount),
        ),
      });
      await tx.salesDocument.update({
        where: { id },
        data: {
          customerId: customer.id,
          templateId: input.templateId ?? d.templateId,
          date: toDate(input.date),
          dueDate: input.dueDate ? toDate(input.dueDate) : null,
          poNumber: input.poNumber ?? null,
          placeOfSupply: pos,
          note: input.note ?? null,
          terms: input.terms ?? null,
          relatedId: input.relatedId ?? d.relatedId,
          subtotal: totals.subtotal,
          cgst: totals.cgst,
          sgst: totals.sgst,
          igst: totals.igst,
          total: totals.total,
        },
      });
      await this.books.record(tx, tenant, auth, 'sales.document.update', 'sales_document', id, meta);
      return this.present(
        tx,
        await tx.salesDocument.findUniqueOrThrow({ where: { id }, include: DOC_INCLUDE }),
      );
    });
  }

  async document(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) =>
      this.present(tx, await this.load(tx, tenant, id, 'finance.view')),
    );
  }

  async documents(tenant: TenantContext, auth: AuthContext, q: z.output<typeof salesDocumentListSchema>) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, q.companyId, 'finance.view');
      const today = toDate(iso(new Date()));
      const where: Prisma.SalesDocumentWhereInput = { companyId: q.companyId, type: q.type };
      if (q.customerId) where.customerId = q.customerId;
      if (q.status === 'OPEN') where.status = { in: ['ISSUED', 'PARTIALLY_PAID'] };
      else if (q.status === 'OVERDUE') {
        where.status = { in: ['ISSUED', 'PARTIALLY_PAID'] };
        where.dueDate = { lt: today };
      } else if (q.status !== 'ALL') where.status = q.status;
      if (q.q) {
        where.OR = [
          { number: { contains: q.q, mode: 'insensitive' } },
          { customer: { name: { contains: q.q, mode: 'insensitive' } } },
        ];
      }
      const rows = await tx.salesDocument.findMany({
        where,
        include: { customer: { select: { id: true, name: true } }, template: { select: { name: true } } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 300,
      });
      return rows.map((r) => ({
        id: r.id,
        number: r.number,
        type: r.type,
        status: r.status,
        date: iso(r.date),
        dueDate: r.dueDate ? iso(r.dueDate) : null,
        overdue: !!r.dueDate && r.dueDate < today && (r.status === 'ISSUED' || r.status === 'PARTIALLY_PAID'),
        customer: r.customer,
        template: r.template?.name ?? null,
        total: num(r.total),
        outstanding:
          r.type === 'INVOICE' && (r.status === 'ISSUED' || r.status === 'PARTIALLY_PAID')
            ? toRupees(toPaise(num(r.total)) - toPaise(num(r.settled)))
            : 0,
      }));
    });
  }

  async issue(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const d = await this.load(tx, tenant, id, 'finance.manage');
      if (d.status !== 'DRAFT') throw new AppError('DOCUMENT_LOCKED', 'This document is already issued', 409);
      const type = d.type;
      const number = await this.nextNumber(tx, d.companyId, PREFIX[type], d.date, 'doc');
      const hasTax = toPaise(num(d.cgst) + num(d.sgst) + num(d.igst)) > 0;
      let dueDate = d.dueDate;
      let status: Status = 'ISSUED';
      let settled = 0;
      let journalEntryId: string | null = null;

      if (type === 'INVOICE' || type === 'CREDIT_NOTE') {
        const { state } = await this.sellerState(tx, d.companyId);
        if (hasTax && !state) {
          throw new AppError(
            'SELLER_STATE_MISSING',
            'Add your GSTIN or state under Sales settings before issuing a tax invoice',
            409,
          );
        }
        if (toPaise(num(d.total)) === 0) throw new AppError('EMPTY_DOCUMENT', 'The total is zero', 409);
        await this.books.ensureSystemAccounts(tx, tenant.id, d.companyId);
        const sign = type === 'INVOICE' ? 1 : -1;
        const line = (systemKey: string, amount: number, narration: string) => ({
          systemKey,
          debit: sign === 1 ? 0 : amount,
          credit: sign === 1 ? amount : 0,
          narration,
        });
        const ref = `${number} · ${d.customer.name}`;
        const lines = [
          {
            systemKey: 'RECEIVABLES',
            debit: sign === 1 ? num(d.total) : 0,
            credit: sign === 1 ? 0 : num(d.total),
            narration: ref,
          },
          line('SALES', num(d.subtotal), 'Sales'),
          line('GST_OUT_CGST', num(d.cgst), 'CGST'),
          line('GST_OUT_SGST', num(d.sgst), 'SGST'),
          line('GST_OUT_IGST', num(d.igst), 'IGST'),
        ];
        if (type === 'CREDIT_NOTE') {
          const inv = await tx.salesDocument.findUnique({ where: { id: d.relatedId ?? '' } });
          const room = inv ? toPaise(num(inv.total)) - toPaise(num(inv.settled)) : 0;
          if (!inv || toPaise(num(d.total)) > room) {
            throw new AppError(
              'CREDIT_TOO_LARGE',
              'A credit note can’t be more than what is still owed on the invoice',
              409,
            );
          }
        }
        const entry = await this.books.postSystem(tx, {
          tenantId: tenant.id,
          companyId: d.companyId,
          date: d.date,
          narration: `${type === 'INVOICE' ? 'Invoice' : 'Credit note'} ${number} · ${d.customer.name}`,
          source: 'SALES_DOCUMENT',
          sourceId: d.id,
          createdByUserId: auth.user.id,
          lines,
        });
        journalEntryId = entry.id;
        if (type === 'INVOICE') {
          dueDate = dueDate ?? addDays(d.date, d.customer.paymentTermsDays);
        } else {
          const inv = await tx.salesDocument.findUniqueOrThrow({ where: { id: d.relatedId! } });
          const s = toRupees(toPaise(num(inv.settled)) + toPaise(num(d.total)));
          await tx.salesDocument.update({
            where: { id: inv.id },
            data: { settled: s, status: settledStatus(num(inv.total), s) },
          });
          status = 'PAID';
          settled = num(d.total);
        }
      }

      await tx.salesDocument.update({
        where: { id },
        data: { number, status, dueDate, settled, journalEntryId, issuedAt: new Date() },
      });
      await this.books.record(tx, tenant, auth, 'sales.document.issue', 'sales_document', id, meta, {
        number,
      });
      return this.present(
        tx,
        await tx.salesDocument.findUniqueOrThrow({ where: { id }, include: DOC_INCLUDE }),
      );
    });
  }

  async cancel(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const d = await this.load(tx, tenant, id, 'finance.manage');
      const accounting = d.type === 'INVOICE' || d.type === 'CREDIT_NOTE';
      if (d.status === 'CANCELLED') throw new AppError('DOCUMENT_LOCKED', 'Already cancelled', 409);
      if (accounting && d.status !== 'DRAFT') {
        throw new AppError(
          'DOCUMENT_LOCKED',
          'An issued invoice is corrected with a credit note, not cancelled',
          409,
        );
      }
      if (!accounting && (d.status === 'PAID' || d.status === 'PARTIALLY_PAID')) {
        throw new AppError('DOCUMENT_LOCKED', 'This document can’t be cancelled', 409);
      }
      await tx.salesDocument.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.books.record(tx, tenant, auth, 'sales.document.cancel', 'sales_document', id, meta);
      return this.present(
        tx,
        await tx.salesDocument.findUniqueOrThrow({ where: { id }, include: DOC_INCLUDE }),
      );
    });
  }

  /** A new draft copied from another: a quotation or proforma becomes an invoice, an invoice gets a credit note. */
  async derive(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    to: 'INVOICE' | 'CREDIT_NOTE',
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const d = await this.load(tx, tenant, id, 'finance.manage');
      if (d.status === 'DRAFT' || d.status === 'CANCELLED') {
        throw new AppError('DOCUMENT_LOCKED', 'Issue the document first', 409);
      }
      const from = d.type;
      const ok =
        (to === 'INVOICE' && (from === 'QUOTATION' || from === 'PROFORMA' || from === 'CHALLAN')) ||
        (to === 'CREDIT_NOTE' && from === 'INVOICE');
      if (!ok)
        throw new AppError('NOT_ALLOWED', `A ${from.toLowerCase().replace('_', ' ')} can’t become this`, 409);
      const today = toDate(iso(new Date()));
      const doc = await tx.salesDocument.create({
        data: {
          tenantId: tenant.id,
          companyId: d.companyId,
          customerId: d.customerId,
          templateId: d.templateId,
          type: to,
          date: today,
          poNumber: d.poNumber,
          placeOfSupply: d.placeOfSupply,
          note: d.note,
          terms: d.terms,
          relatedId: d.id,
          subtotal: d.subtotal,
          cgst: d.cgst,
          sgst: d.sgst,
          igst: d.igst,
          total: d.total,
          createdByUserId: auth.user.id,
        },
      });
      await tx.salesDocumentLine.createMany({
        data: d.lines.map((l) => ({
          tenantId: tenant.id,
          documentId: doc.id,
          position: l.position,
          description: l.description,
          hsn: l.hsn,
          quantity: l.quantity,
          unit: l.unit,
          rate: l.rate,
          discountPct: l.discountPct,
          gstRate: l.gstRate,
          amount: l.amount,
        })),
      });
      await this.books.record(tx, tenant, auth, 'sales.document.derive', 'sales_document', doc.id, meta, {
        from: from,
        to,
      });
      return this.present(
        tx,
        await tx.salesDocument.findUniqueOrThrow({ where: { id: doc.id }, include: DOC_INCLUDE }),
      );
    });
  }

  // ---- Receipts -----------------------------------------------------------------------------------

  async receipts(tenant: TenantContext, auth: AuthContext, companyId: string, customerId?: string) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, companyId, 'finance.view');
      const rows = await tx.customerReceipt.findMany({
        where: { companyId, ...(customerId ? { customerId } : {}) },
        include: {
          customer: { select: { id: true, name: true } },
          allocations: { include: { document: { select: { number: true } } } },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 300,
      });
      return rows.map((r) => ({
        id: r.id,
        number: r.number,
        date: iso(r.date),
        customer: r.customer,
        amount: num(r.amount),
        mode: r.mode,
        reference: r.reference,
        allocations: r.allocations.map((a) => ({
          documentId: a.documentId,
          number: a.document.number,
          amount: num(a.amount),
        })),
        unallocated: toRupees(
          toPaise(num(r.amount)) - r.allocations.reduce((s, a) => s + toPaise(num(a.amount)), 0),
        ),
      }));
    });
  }

  async recordReceipt(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof receiptSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, input.companyId, 'finance.manage');
      const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
      if (!customer) throw new NotFoundError('Customer');
      const deposit = await tx.ledgerAccount.findFirst({
        where: { id: input.depositAccountId, companyId: input.companyId, status: 'ACTIVE', type: 'ASSET' },
      });
      if (!deposit) {
        throw new AppError('VALIDATION_FAILED', 'Choose a bank or cash account of this company', 400, [
          { path: 'depositAccountId', message: 'Choose a bank or cash account' },
        ]);
      }
      const date = toDate(input.date);
      const amount = toPaise(input.amount);

      // Open invoices of this customer, oldest first. Locked so two receipts can't take the same balance.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`receipt:${input.customerId}`}))`;
      const open = await tx.salesDocument.findMany({
        where: {
          companyId: input.companyId,
          customerId: input.customerId,
          type: 'INVOICE',
          status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
        },
        orderBy: [{ date: 'asc' }, { number: 'asc' }],
      });
      const room = new Map(open.map((o) => [o.id, toPaise(num(o.total)) - toPaise(num(o.settled))]));
      let plan: { documentId: string; amount: number }[];
      if (input.allocations) {
        plan = input.allocations.map((a) => ({ documentId: a.documentId, amount: toPaise(a.amount) }));
        for (const a of plan) {
          if (!room.has(a.documentId) || a.amount > room.get(a.documentId)!) {
            throw new AppError(
              'OVER_ALLOCATED',
              'An invoice is paid more than it is owed, or isn’t open for this customer',
              400,
            );
          }
        }
        if (plan.reduce((s, a) => s + a.amount, 0) > amount) {
          throw new AppError('OVER_ALLOCATED', 'The invoices add up to more than the amount received', 400);
        }
      } else {
        let left = amount;
        plan = [];
        for (const o of open) {
          if (left <= 0) break;
          const take = Math.min(left, room.get(o.id)!);
          if (take > 0) plan.push({ documentId: o.id, amount: take });
          left -= take;
        }
      }

      const number = await this.nextNumber(tx, input.companyId, 'RCT', date, 'receipt');
      await this.books.ensureSystemAccounts(tx, tenant.id, input.companyId);
      const receipt = await tx.customerReceipt.create({
        data: {
          tenantId: tenant.id,
          companyId: input.companyId,
          customerId: input.customerId,
          number,
          date,
          amount: input.amount,
          mode: input.mode,
          reference: input.reference ?? null,
          note: input.note ?? null,
          depositAccountId: deposit.id,
          createdByUserId: auth.user.id,
        },
      });
      for (const a of plan) {
        await tx.receiptAllocation.create({
          data: {
            tenantId: tenant.id,
            receiptId: receipt.id,
            documentId: a.documentId,
            amount: toRupees(a.amount),
          },
        });
        const doc = open.find((o) => o.id === a.documentId)!;
        const settled = toRupees(toPaise(num(doc.settled)) + a.amount);
        await tx.salesDocument.update({
          where: { id: doc.id },
          data: { settled, status: settledStatus(num(doc.total), settled) },
        });
      }
      const entry = await this.books.postSystem(tx, {
        tenantId: tenant.id,
        companyId: input.companyId,
        date,
        narration: `Receipt ${number} · ${customer.name}`,
        source: 'SALES_RECEIPT',
        sourceId: receipt.id,
        createdByUserId: auth.user.id,
        lines: [
          {
            accountId: deposit.id,
            debit: input.amount,
            credit: 0,
            ...(input.reference ? { narration: input.reference } : {}),
          },
          { systemKey: 'RECEIVABLES', debit: 0, credit: input.amount, narration: customer.name },
        ],
      });
      await tx.customerReceipt.update({ where: { id: receipt.id }, data: { journalEntryId: entry.id } });
      await this.books.record(
        tx,
        tenant,
        auth,
        'sales.receipt.create',
        'customer_receipt',
        receipt.id,
        meta,
        {
          number,
          amount: input.amount,
        },
      );
      return {
        id: receipt.id,
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
      const monthStart = toDate(`${iso(new Date()).slice(0, 8)}01`);
      const open = await tx.salesDocument.findMany({
        where: { companyId, type: 'INVOICE', status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
        select: { total: true, settled: true, dueDate: true },
      });
      let outstanding = 0;
      let overdue = 0;
      let overdueCount = 0;
      for (const o of open) {
        const owed = toPaise(num(o.total)) - toPaise(num(o.settled));
        outstanding += owed;
        if (o.dueDate && o.dueDate < today) {
          overdue += owed;
          overdueCount += 1;
        }
      }
      const paid = await tx.customerReceipt.aggregate({
        where: { companyId, date: { gte: monthStart } },
        _sum: { amount: true },
        _count: true,
      });
      const drafts = await tx.salesDocument.count({ where: { companyId, type: 'INVOICE', status: 'DRAFT' } });
      return {
        outstanding: toRupees(outstanding),
        outstandingCount: open.length,
        overdue: toRupees(overdue),
        overdueCount,
        receivedThisMonth: num(paid._sum.amount),
        receivedCount: paid._count,
        drafts,
      };
    });
  }

  /** What each customer owes, by how late it is. */
  async ageing(tenant: TenantContext, auth: AuthContext, companyId: string, asOf?: string) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, companyId, 'finance.view');
      const day = asOf ?? iso(new Date());
      const ref = toDate(day).getTime();
      const rows = await tx.salesDocument.findMany({
        where: { companyId, type: 'INVOICE', status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
        include: { customer: { select: { id: true, name: true } } },
      });
      const BUCKETS = ['current', 'd1to30', 'd31to60', 'd61to90', 'over90'] as const;
      const byCustomer = new Map<
        string,
        {
          customer: { id: string; name: string };
          current: number;
          d1to30: number;
          d31to60: number;
          d61to90: number;
          over90: number;
          total: number;
        }
      >();
      for (const r of rows) {
        const owed = toPaise(num(r.total)) - toPaise(num(r.settled));
        const late = r.dueDate ? Math.floor((ref - r.dueDate.getTime()) / 86_400_000) : 0;
        const bucket = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
        const row = byCustomer.get(r.customerId) ?? {
          customer: r.customer,
          current: 0,
          d1to30: 0,
          d31to60: 0,
          d61to90: 0,
          over90: 0,
          total: 0,
        };
        row[BUCKETS[bucket]] += owed;
        row.total += owed;
        byCustomer.set(r.customerId, row);
      }
      const list = [...byCustomer.values()]
        .map((r) => ({
          customer: r.customer,
          current: toRupees(r.current),
          d1to30: toRupees(r.d1to30),
          d31to60: toRupees(r.d31to60),
          d61to90: toRupees(r.d61to90),
          over90: toRupees(r.over90),
          total: toRupees(r.total),
        }))
        .sort((a, b) => b.total - a.total);
      const sum = (k: 'current' | 'd1to30' | 'd31to60' | 'd61to90' | 'over90' | 'total') =>
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

  /** A customer's statement: invoices owed, credit notes and receipts, with a running balance. */
  async statement(
    tenant: TenantContext,
    auth: AuthContext,
    customerId: string,
    companyId: string,
    from: string,
    to: string,
  ) {
    return this.run(tenant, auth, async (tx) => {
      await this.books.assertCompany(tx, tenant, companyId, 'finance.view');
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw new NotFoundError('Customer');
      const docs = await tx.salesDocument.findMany({
        where: {
          companyId,
          customerId,
          type: { in: ['INVOICE', 'CREDIT_NOTE'] },
          status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] },
        },
        select: { id: true, number: true, type: true, date: true, total: true },
      });
      const receipts = await tx.customerReceipt.findMany({
        where: { companyId, customerId },
        select: { id: true, number: true, date: true, amount: true, reference: true },
      });
      type Entry = {
        id: string;
        date: string;
        kind: 'INVOICE' | 'CREDIT_NOTE' | 'RECEIPT';
        number: string | null;
        debit: number;
        credit: number;
      };
      const entries: Entry[] = [
        ...docs.map((d) => ({
          id: d.id,
          date: iso(d.date),
          kind: d.type as 'INVOICE' | 'CREDIT_NOTE',
          number: d.number,
          debit: d.type === 'INVOICE' ? num(d.total) : 0,
          credit: d.type === 'CREDIT_NOTE' ? num(d.total) : 0,
        })),
        ...receipts.map((r) => ({
          id: r.id,
          date: iso(r.date),
          kind: 'RECEIPT' as const,
          number: r.number,
          debit: 0,
          credit: num(r.amount),
        })),
      ].sort((a, b) => a.date.localeCompare(b.date) || (a.number ?? '').localeCompare(b.number ?? ''));
      let opening = 0;
      for (const e of entries.filter((x) => x.date < from)) opening += toPaise(e.debit) - toPaise(e.credit);
      let bal = opening;
      const rows = entries
        .filter((x) => x.date >= from && x.date <= to)
        .map((e) => {
          bal += toPaise(e.debit) - toPaise(e.credit);
          return { ...e, balance: toRupees(bal) };
        });
      return {
        customer: { id: customer.id, name: customer.name, gstin: customer.gstin },
        from,
        to,
        opening: toRupees(opening),
        closing: toRupees(bal),
        rows,
      };
    });
  }
}
