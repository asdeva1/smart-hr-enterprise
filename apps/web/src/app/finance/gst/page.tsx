'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { inr, useBooksCompany } from '@/lib/finance';
import {
  RECON_LABEL,
  RECON_TONE,
  downloadCsv,
  monthRange,
  type Gstr1,
  type Gstr1Doc,
  type Gstr3b,
  type PurchaseRegister,
  type Reconciliation,
  type TdsReport,
} from '@/lib/gst';
import { CompanyPicker, FinancePage } from '../finance-page';

const VIEWS = [
  { value: 'gstr1', label: 'GSTR-1' },
  { value: 'gstr3b', label: 'GSTR-3B summary' },
  { value: 'register', label: 'Purchase register' },
  { value: '2b', label: 'GSTR-2B check' },
  { value: 'tds', label: 'TDS' },
] as const;
type View = (typeof VIEWS)[number]['value'];

export default function GstPage() {
  return <FinancePage active="GST and TDS">{() => <Gst />}</FinancePage>;
}

function Gst() {
  const [companyId, setCompanyId] = useBooksCompany();
  const [view, setView] = useState<View>('gstr1');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { from, to } = monthRange(month);
  const qs = `companyId=${companyId}&from=${from}&to=${to}`;
  return (
    <>
      <PageHeader
        title="GST and TDS"
        description="Return figures worked out from your posted invoices, credit notes, bills and debit notes. Check them, then file on the GST portal."
      />
      <div className="flex flex-wrap items-end gap-4">
        <CompanyPicker value={companyId} onChange={setCompanyId} />
        <Field id="gst-month" label="Return month">
          <Input
            id="gst-month"
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
          />
        </Field>
      </div>
      <Tabs label="Report" value={view} onChange={setView} options={[...VIEWS]} />
      {!companyId ? (
        <Loading />
      ) : view === 'gstr1' ? (
        <Gstr1View qs={qs} month={month} />
      ) : view === 'gstr3b' ? (
        <Gstr3bView qs={qs} />
      ) : view === 'register' ? (
        <RegisterView qs={qs} month={month} />
      ) : view === '2b' ? (
        <ReconcileView companyId={companyId} from={from} to={to} />
      ) : (
        <TdsView qs={qs} month={month} />
      )}
    </>
  );
}

const money = (n: number) => (n ? inr(n) : '');

function Box({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function DocTable({ rows, credit }: { rows: Gstr1Doc[]; credit?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">None this month.</p>;
  return (
    <Table label="Documents">
      <thead>
        <tr>
          <Th>Number</Th>
          <Th>Date</Th>
          <Th>Customer</Th>
          <Th>GSTIN</Th>
          {credit && <Th>Against</Th>}
          <Th className="text-right">Taxable</Th>
          <Th className="text-right">CGST</Th>
          <Th className="text-right">SGST</Th>
          <Th className="text-right">IGST</Th>
          <Th className="text-right">Total</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td className="whitespace-nowrap">
              <Link href={`/finance/invoices/${r.id}`} className="text-primary hover:underline">
                {r.number}
              </Link>
            </Td>
            <Td className="whitespace-nowrap">{r.date}</Td>
            <Td>{r.customer}</Td>
            <Td className="whitespace-nowrap">{r.gstin ?? ''}</Td>
            {credit && <Td>{r.against?.number ?? ''}</Td>}
            <Td className="text-right tabular-nums">{inr(r.taxable)}</Td>
            <Td className="text-right tabular-nums">{money(r.cgst)}</Td>
            <Td className="text-right tabular-nums">{money(r.sgst)}</Td>
            <Td className="text-right tabular-nums">{money(r.igst)}</Td>
            <Td className="text-right tabular-nums">{inr(r.total)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Gstr1View({ qs, month }: { qs: string; month: string }) {
  const q = useQuery({
    queryKey: ['gst', 'gstr1', qs],
    queryFn: () => apiFetch<Gstr1>(`/v1/finance/gst/gstr1?${qs}`),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <Alert tone="error">{errorMessage(q.error)}</Alert>;
  const r = q.data;
  const docCsv = (name: string, rows: Gstr1Doc[]) =>
    downloadCsv(
      `gstr1-${name}-${month}.csv`,
      ['Number', 'Date', 'Customer', 'GSTIN', 'Place of supply', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'],
      rows.map((d) => [
        d.number,
        d.date,
        d.customer,
        d.gstin,
        d.placeOfSupply,
        d.taxable,
        d.cgst,
        d.sgst,
        d.igst,
        d.total,
      ]),
    );
  const csvBtn = (name: string, rows: Gstr1Doc[]) => (
    <Button variant="outline" disabled={rows.length === 0} onClick={() => docCsv(name, rows)}>
      Download CSV
    </Button>
  );
  return (
    <>
      {r.warnings.sellerGstinMissing && (
        <Alert tone="warning">
          Your company’s GSTIN is not set. Add it under{' '}
          <Link href="/finance/sales-settings" className="underline">
            Sales settings
          </Link>{' '}
          before you file.
        </Alert>
      )}
      {r.warnings.documentsWithoutHsn.length > 0 && (
        <Alert tone="warning">
          HSN or SAC is missing on {r.warnings.documentsWithoutHsn.join(', ')}. The portal needs it for the
          HSN summary.
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Figure label="Taxable sales, net of credit notes" value={r.totals.net.taxable} />
        <Figure label="Tax on sales, net" value={r.totals.net.cgst + r.totals.net.sgst + r.totals.net.igst} />
        <Figure label="Credit notes (taxable)" value={r.totals.creditNotes.taxable} />
      </div>
      <Box title={`B2B invoices (${r.b2b.length})`} action={csvBtn('b2b', r.b2b)}>
        <DocTable rows={r.b2b} />
      </Box>
      <Box
        title={`B2C large invoices, inter-state over ₹2.5 lakh (${r.b2cl.length})`}
        action={csvBtn('b2cl', r.b2cl)}
      >
        <DocTable rows={r.b2cl} />
      </Box>
      <Box
        title="B2C small, by state and rate"
        action={
          <Button
            variant="outline"
            disabled={r.b2cs.length === 0}
            onClick={() =>
              downloadCsv(
                `gstr1-b2cs-${month}.csv`,
                ['Place of supply', 'Rate', 'Taxable', 'CGST', 'SGST', 'IGST'],
                r.b2cs.map((x) => [x.pos, x.rate, x.taxable, x.cgst, x.sgst, x.igst]),
              )
            }
          >
            Download CSV
          </Button>
        }
      >
        {r.b2cs.length === 0 ? (
          <p className="text-sm text-muted-foreground">None this month.</p>
        ) : (
          <Table label="B2C small">
            <thead>
              <tr>
                <Th>State code</Th>
                <Th className="text-right">Rate</Th>
                <Th className="text-right">Taxable</Th>
                <Th className="text-right">CGST</Th>
                <Th className="text-right">SGST</Th>
                <Th className="text-right">IGST</Th>
              </tr>
            </thead>
            <tbody>
              {r.b2cs.map((x) => (
                <tr key={`${x.pos}-${x.rate}`}>
                  <Td>{x.pos ?? '—'}</Td>
                  <Td className="text-right">{x.rate}%</Td>
                  <Td className="text-right tabular-nums">{inr(x.taxable)}</Td>
                  <Td className="text-right tabular-nums">{money(x.cgst)}</Td>
                  <Td className="text-right tabular-nums">{money(x.sgst)}</Td>
                  <Td className="text-right tabular-nums">{money(x.igst)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Box>
      <Box title={`Credit notes to registered customers (${r.cdnr.length})`} action={csvBtn('cdnr', r.cdnr)}>
        <DocTable rows={r.cdnr} credit />
      </Box>
      <Box
        title={`Credit notes to unregistered customers (${r.cdnur.length})`}
        action={csvBtn('cdnur', r.cdnur)}
      >
        <DocTable rows={r.cdnur} credit />
      </Box>
      <Box
        title="HSN summary"
        action={
          <Button
            variant="outline"
            disabled={r.hsn.length === 0}
            onClick={() =>
              downloadCsv(
                `gstr1-hsn-${month}.csv`,
                ['HSN or SAC', 'Rate', 'Unit', 'Quantity', 'Value', 'Taxable', 'CGST', 'SGST', 'IGST'],
                r.hsn.map((x) => [
                  x.hsn,
                  x.rate,
                  x.unit,
                  x.quantity,
                  x.value,
                  x.taxable,
                  x.cgst,
                  x.sgst,
                  x.igst,
                ]),
              )
            }
          >
            Download CSV
          </Button>
        }
      >
        {r.hsn.length === 0 ? (
          <p className="text-sm text-muted-foreground">None this month.</p>
        ) : (
          <Table label="HSN summary">
            <thead>
              <tr>
                <Th>HSN or SAC</Th>
                <Th className="text-right">Rate</Th>
                <Th className="text-right">Quantity</Th>
                <Th className="text-right">Taxable</Th>
                <Th className="text-right">CGST</Th>
                <Th className="text-right">SGST</Th>
                <Th className="text-right">IGST</Th>
              </tr>
            </thead>
            <tbody>
              {r.hsn.map((x) => (
                <tr key={`${x.hsn}-${x.rate}-${x.unit}`}>
                  <Td>{x.hsn || '—'}</Td>
                  <Td className="text-right">{x.rate}%</Td>
                  <Td className="text-right tabular-nums">{x.quantity}</Td>
                  <Td className="text-right tabular-nums">{inr(x.taxable)}</Td>
                  <Td className="text-right tabular-nums">{money(x.cgst)}</Td>
                  <Td className="text-right tabular-nums">{money(x.sgst)}</Td>
                  <Td className="text-right tabular-nums">{money(x.igst)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Box>
    </>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3.5">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums">₹{inr(value)}</div>
    </div>
  );
}

function Gstr3bView({ qs }: { qs: string }) {
  const q = useQuery({
    queryKey: ['gst', '3b', qs],
    queryFn: () => apiFetch<Gstr3b>(`/v1/finance/gst/gstr3b?${qs}`),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <Alert tone="error">{errorMessage(q.error)}</Alert>;
  const r = q.data;
  const NAME = { igst: 'IGST', cgst: 'CGST', sgst: 'SGST' } as const;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Figure label="Taxable sales, net" value={r.outward.taxable} />
        <Figure label="Taxable purchases, net" value={r.itc.taxable} />
        <Figure
          label={r.netPayable >= 0 ? 'Tax to pay' : 'Credit to carry forward'}
          value={Math.abs(r.netPayable)}
        />
      </div>
      <Table label="Tax payable by head">
        <thead>
          <tr>
            <Th>Tax</Th>
            <Th className="text-right">On sales</Th>
            <Th className="text-right">Input credit</Th>
            <Th className="text-right">To pay (credit if negative)</Th>
          </tr>
        </thead>
        <tbody>
          {r.heads.map((h) => (
            <tr key={h.head}>
              <Td className="font-medium">{NAME[h.head]}</Td>
              <Td className="text-right tabular-nums">{inr(h.output)}</Td>
              <Td className="text-right tabular-nums">{inr(h.itc)}</Td>
              <Td className="text-right font-medium tabular-nums">{inr(h.payable)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="text-sm text-muted-foreground">{r.note}</p>
    </>
  );
}

function RegisterView({ qs, month }: { qs: string; month: string }) {
  const q = useQuery({
    queryKey: ['gst', 'register', qs],
    queryFn: () => apiFetch<PurchaseRegister>(`/v1/finance/gst/purchase-register?${qs}`),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <Alert tone="error">{errorMessage(q.error)}</Alert>;
  const r = q.data;
  if (r.rows.length === 0)
    return <EmptyState title="No purchases this month">Posted bills and debit notes appear here.</EmptyState>;
  return (
    <Box
      title="Purchase register (input tax credit)"
      action={
        <Button
          variant="outline"
          onClick={() =>
            downloadCsv(
              `purchase-register-${month}.csv`,
              [
                'Type',
                'Number',
                'Vendor bill',
                'Date',
                'Vendor',
                'GSTIN',
                'Taxable',
                'CGST',
                'SGST',
                'IGST',
                'Total',
              ],
              r.rows.map((x) => [
                x.type,
                x.number,
                x.vendorBillNo,
                x.date,
                x.vendor,
                x.gstin,
                x.taxable,
                x.cgst,
                x.sgst,
                x.igst,
                x.total,
              ]),
            )
          }
        >
          Download CSV
        </Button>
      }
    >
      <Table label="Purchase register">
        <thead>
          <tr>
            <Th>Number</Th>
            <Th>Date</Th>
            <Th>Vendor</Th>
            <Th>GSTIN</Th>
            <Th className="text-right">Taxable</Th>
            <Th className="text-right">CGST</Th>
            <Th className="text-right">SGST</Th>
            <Th className="text-right">IGST</Th>
          </tr>
        </thead>
        <tbody>
          {r.rows.map((x) => (
            <tr key={x.id}>
              <Td className="whitespace-nowrap">
                <Link href={`/finance/bills/${x.id}`} className="text-primary hover:underline">
                  {x.number}
                </Link>
                {x.type === 'DEBIT_NOTE' && <span className="text-muted-foreground"> (debit note)</span>}
              </Td>
              <Td className="whitespace-nowrap">{x.date}</Td>
              <Td>{x.vendor}</Td>
              <Td>{x.gstin ?? <span className="text-danger">Not registered</span>}</Td>
              <Td className="text-right tabular-nums">{inr(x.taxable)}</Td>
              <Td className="text-right tabular-nums">{money(x.cgst)}</Td>
              <Td className="text-right tabular-nums">{money(x.sgst)}</Td>
              <Td className="text-right tabular-nums">{money(x.igst)}</Td>
            </tr>
          ))}
          <tr className="font-semibold">
            <Td>Net credit</Td>
            <Td />
            <Td />
            <Td />
            <Td className="text-right tabular-nums">{inr(r.totals.taxable)}</Td>
            <Td className="text-right tabular-nums">{inr(r.totals.cgst)}</Td>
            <Td className="text-right tabular-nums">{inr(r.totals.sgst)}</Td>
            <Td className="text-right tabular-nums">{inr(r.totals.igst)}</Td>
          </tr>
        </tbody>
      </Table>
    </Box>
  );
}

function ReconcileView({ companyId, from, to }: { companyId: string; from: string; to: string }) {
  const [fileName, setFileName] = useState('');
  const [problem, setProblem] = useState('');
  const run = useMutation({
    mutationFn: (data: unknown) =>
      apiFetch<Reconciliation>('/v1/finance/gst/gstr2b/reconcile', {
        method: 'POST',
        body: { companyId, from, to, data },
      }),
  });
  async function onFile(file: File | undefined) {
    if (!file) return;
    setProblem('');
    setFileName(file.name);
    try {
      run.mutate(JSON.parse(await file.text()) as unknown);
    } catch {
      setProblem(
        'That file is not valid JSON. Download the GSTR-2B JSON from the GST portal and upload it here.',
      );
    }
  }
  const r = run.data;
  return (
    <>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Upload the GSTR-2B file (JSON) for this month from the GST portal. Each invoice your suppliers filed
        is matched against your posted bills by supplier GSTIN and invoice number. Nothing is saved.
      </p>
      <Field id="gstr2b-file" label="GSTR-2B file">
        <Input
          id="gstr2b-file"
          type="file"
          accept=".json,application/json"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </Field>
      {problem && <Alert tone="error">{problem}</Alert>}
      {run.isError && <Alert tone="error">{errorMessage(run.error)}</Alert>}
      {run.isPending && <Loading />}
      {r && (
        <>
          <p className="text-sm">
            {fileName}: {r.counts.matched} matched, {r.counts.mismatch} differ, {r.counts.missingInBooks} not
            in your books, {r.counts.missingIn2b} not in GSTR-2B.
            {r.skipped.billsWithoutGstinOrNumber > 0 &&
              ` ${r.skipped.billsWithoutGstinOrNumber} bill(s) were left out because the vendor has no GSTIN or the bill has no vendor bill number.`}
          </p>
          <Table label="Reconciliation">
            <thead>
              <tr>
                <Th>Status</Th>
                <Th>Supplier</Th>
                <Th>Invoice</Th>
                <Th>Date</Th>
                <Th className="text-right">Books: taxable / tax</Th>
                <Th className="text-right">GSTR-2B: taxable / tax</Th>
                <Th>What differs</Th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={`${x.gstin}-${x.number}-${x.status}`}>
                  <Td>
                    <Badge tone={RECON_TONE[x.status]}>{RECON_LABEL[x.status]}</Badge>
                  </Td>
                  <Td>
                    {x.supplier ?? ''}
                    <div className="text-xs text-muted-foreground">{x.gstin}</div>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {x.books ? (
                      <Link href={`/finance/bills/${x.books.id}`} className="text-primary hover:underline">
                        {x.number}
                      </Link>
                    ) : (
                      x.number
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{x.date ?? ''}</Td>
                  <Td className="text-right tabular-nums">
                    {x.books
                      ? `${inr(x.books.taxable)} / ${inr(x.books.cgst + x.books.sgst + x.books.igst)}`
                      : ''}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {x.portal
                      ? `${inr(x.portal.taxable)} / ${inr(x.portal.cgst + x.portal.sgst + x.portal.igst)}`
                      : ''}
                  </Td>
                  <Td>{x.differences.join(', ')}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </>
  );
}

function TdsView({ qs, month }: { qs: string; month: string }) {
  const q = useQuery({
    queryKey: ['gst', 'tds', qs],
    queryFn: () => apiFetch<TdsReport>(`/v1/finance/gst/tds?${qs}`),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <Alert tone="error">{errorMessage(q.error)}</Alert>;
  const r = q.data;
  if (r.rows.length === 0)
    return <EmptyState title="No TDS deducted this month">Bills with a TDS rate appear here.</EmptyState>;
  return (
    <>
      {r.vendorsWithoutPan.length > 0 && (
        <Alert tone="warning">
          No PAN on file for {r.vendorsWithoutPan.join(', ')}. Add it on the vendor, or the deduction can’t be
          reported against them.
        </Alert>
      )}
      <Box
        title={`TDS deducted: ₹${inr(r.total)}`}
        action={
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv(
                `tds-${month}.csv`,
                ['Vendor', 'PAN', 'Rate', 'Amount paid or credited', 'TDS deducted', 'Bills'],
                r.rows.map((x) => [x.vendor.name, x.vendor.pan, x.rate, x.base, x.tds, x.bills]),
              )
            }
          >
            Download CSV
          </Button>
        }
      >
        <Table label="TDS by vendor">
          <thead>
            <tr>
              <Th>Vendor</Th>
              <Th>PAN</Th>
              <Th className="text-right">Rate</Th>
              <Th className="text-right">Amount before tax</Th>
              <Th className="text-right">TDS deducted</Th>
              <Th className="text-right">Bills</Th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((x) => (
              <tr key={`${x.vendor.id}-${x.rate}`}>
                <Td className="font-medium">{x.vendor.name}</Td>
                <Td>{x.vendor.pan ?? ''}</Td>
                <Td className="text-right">{x.rate}%</Td>
                <Td className="text-right tabular-nums">{inr(x.base)}</Td>
                <Td className="text-right tabular-nums">{inr(x.tds)}</Td>
                <Td className="text-right">{x.bills}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Box>
    </>
  );
}
