'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { errorMessage, useCompanies } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { financeKeys, inr } from '@/lib/finance';
import { can } from '@/lib/permissions';
import { DOC_TYPE_LABEL, STATUS_LABEL, STATUS_TONE, salesKeys, type SalesDocument } from '@/lib/sales';
import { FinancePage } from '../../finance-page';
import { ReceiptDialog } from '../../receipts/receipt-dialog';
import { DocumentEditor } from '../document-editor';
import { DocumentPreview } from '../document-preview';

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <FinancePage active="Invoices">
      {(session) => <Document id={id} canManage={can(session, 'finance.manage')} />}
    </FinancePage>
  );
}

function Document({ id, canManage }: { id: string; canManage: boolean }) {
  const router = useRouter();
  const client = useQueryClient();
  const companies = useCompanies();
  const [paying, setPaying] = useState(false);
  const doc = useQuery({
    queryKey: salesKeys.document(id),
    queryFn: () => apiFetch<SalesDocument>(`/v1/finance/sales/documents/${id}`),
  });
  const act = useMutation({
    mutationFn: ({ path }: { path: 'cancel' | 'invoice' | 'credit-note' | 'issue' }) =>
      apiFetch<SalesDocument>(`/v1/finance/sales/documents/${id}/${path}`, { method: 'POST' }),
    onSuccess: async (next, { path }) => {
      await client.invalidateQueries({ queryKey: salesKeys.all });
      await client.invalidateQueries({ queryKey: financeKeys.all });
      if (path === 'invoice' || path === 'credit-note') router.push(`/finance/invoices/${next.id}`);
    },
  });
  if (doc.isPending) return <Loading />;
  if (doc.isError) return <Alert tone="error">{errorMessage(doc.error)}</Alert>;
  const d = doc.data;
  const label = DOC_TYPE_LABEL[d.type];

  if (d.status === 'DRAFT' && canManage) {
    return (
      <>
        <p>
          <Link href="/finance/invoices" className="text-sm text-primary hover:underline">
            ← Back to invoices
          </Link>
        </p>
        <DocumentEditor key={d.id} companyId={d.companyId} type={d.type} existing={d} />
        <div>
          <Button
            variant="danger"
            disabled={act.isPending}
            onClick={() =>
              act.mutate({ path: 'cancel' }, { onSuccess: () => router.push('/finance/invoices') })
            }
          >
            Discard this draft
          </Button>
        </div>
        {act.isError && <Alert tone="error">{errorMessage(act.error)}</Alert>}
      </>
    );
  }

  const open = d.type === 'INVOICE' && (d.status === 'ISSUED' || d.status === 'PARTIALLY_PAID');
  const issued = d.status !== 'DRAFT' && d.status !== 'CANCELLED';
  return (
    <>
      <p className="print:hidden">
        <Link href="/finance/invoices" className="text-sm text-primary hover:underline">
          ← Back to invoices
        </Link>
      </p>
      <PageHeader
        title={`${label} ${d.number ?? ''}`.trim()}
        description={`${d.customer.name} · ${d.date}`}
        actions={
          <>
            <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
            <Button variant="outline" onClick={() => window.print()}>
              Print or save as PDF
            </Button>
            {canManage && open && <Button onClick={() => setPaying(true)}>Record payment</Button>}
            {canManage && d.type === 'INVOICE' && issued && (
              <Button
                variant="outline"
                disabled={act.isPending}
                onClick={() => act.mutate({ path: 'credit-note' })}
              >
                Create credit note
              </Button>
            )}
            {canManage &&
              issued &&
              (d.type === 'QUOTATION' || d.type === 'PROFORMA' || d.type === 'CHALLAN') && (
                <Button disabled={act.isPending} onClick={() => act.mutate({ path: 'invoice' })}>
                  Convert to invoice
                </Button>
              )}
            {canManage && issued && d.type !== 'INVOICE' && d.type !== 'CREDIT_NOTE' && (
              <Button
                variant="danger"
                disabled={act.isPending}
                onClick={() => act.mutate({ path: 'cancel' })}
              >
                Cancel
              </Button>
            )}
          </>
        }
      />
      {act.isError && <Alert tone="error">{errorMessage(act.error)}</Alert>}
      {d.type === 'INVOICE' && issued && (
        <div className="flex flex-wrap gap-6 rounded-lg border border-border bg-card px-5 py-4 text-sm print:hidden">
          <div>
            <div className="text-muted-foreground">Total</div>
            <div className="text-lg font-semibold tabular-nums">₹{inr(d.total)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Received or credited</div>
            <div className="text-lg font-semibold text-success tabular-nums">₹{inr(d.settled)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Still owed</div>
            <div className="text-lg font-semibold tabular-nums">₹{inr(d.outstanding)}</div>
          </div>
          {d.journalEntryId && (
            <div className="self-end">
              <Link href={`/finance/journals/${d.journalEntryId}`} className="text-primary hover:underline">
                See the journal in the books
              </Link>
            </div>
          )}
        </div>
      )}
      {d.relatedId && (
        <p className="text-sm print:hidden">
          <Link href={`/finance/invoices/${d.relatedId}`} className="text-primary hover:underline">
            See the related document
          </Link>
        </p>
      )}
      <div className="max-w-3xl">
        <DocumentPreview
          template={d.template}
          doc={{
            type: d.type,
            number: d.number,
            date: d.date,
            dueDate: d.dueDate,
            poNumber: d.poNumber,
            companyName:
              d.company?.legalName ??
              d.company?.name ??
              companies.data?.find((c) => c.id === d.companyId)?.name ??
              '',
            seller: d.seller,
            customer: d.customer,
            placeOfSupply: d.placeOfSupply,
            lines: d.lines.map((l) => ({ ...l, amount: l.amount ?? 0 })),
            subtotal: d.subtotal,
            cgst: d.cgst,
            sgst: d.sgst,
            igst: d.igst,
            total: d.total,
            amountInWords: d.amountInWords,
            note: d.note,
            terms: d.terms,
          }}
        />
      </div>
      {paying && (
        <ReceiptDialog
          companyId={d.companyId}
          customerId={d.customer.id}
          amount={d.outstanding}
          onClose={() => setPaying(false)}
        />
      )}
    </>
  );
}
