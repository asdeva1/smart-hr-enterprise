'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { JournalDialog } from '@/components/finance/journal-form';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import {
  financeKeys,
  inr,
  JOURNAL_STATUS_LABEL,
  JOURNAL_STATUS_TONE,
  SOURCE_LABEL,
  type Journal,
} from '@/lib/finance';
import { FinancePage } from '../../finance-page';

export default function JournalPage() {
  const { id } = useParams<{ id: string }>();
  // Approvers may open a journal sent to them without finance access, so the page asks for none.
  return <FinancePage permission="">{() => <JournalDetail id={id} />}</FinancePage>;
}

function JournalDetail({ id }: { id: string }) {
  const client = useQueryClient();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [reversing, setReversing] = useState(false);
  const journal = useQuery({
    queryKey: financeKeys.journal(id),
    queryFn: () => apiFetch<Journal>(`/v1/finance/journals/${id}`),
  });
  const act = useMutation({
    mutationFn: (action: 'submit' | 'cancel') =>
      apiFetch<Journal>(`/v1/finance/journals/${id}/${action}`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: financeKeys.all }),
  });
  if (journal.isPending) return <Loading />;
  if (journal.isError) return <Alert tone="error">{errorMessage(journal.error)}</Alert>;
  const j = journal.data;
  const debit = j.lines.reduce((s, l) => s + l.debit, 0);
  const credit = j.lines.reduce((s, l) => s + l.credit, 0);
  return (
    <>
      <PageHeader
        title={j.number ?? 'Draft journal'}
        description={j.narration}
        actions={
          <div className="flex flex-wrap gap-2">
            {j.can?.edit && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {j.can?.cancel && (
              <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate('cancel')}>
                Cancel journal
              </Button>
            )}
            {j.can?.submit && (
              <Button disabled={act.isPending} onClick={() => act.mutate('submit')}>
                Send for approval
              </Button>
            )}
            {j.can?.reverse && (
              <Button variant="outline" onClick={() => setReversing(true)}>
                Reverse
              </Button>
            )}
          </div>
        }
      />
      <p>
        <Link href="/finance" className="text-sm text-primary hover:underline">
          ← All journals
        </Link>
      </p>
      {act.isError && <Alert tone="error">{errorMessage(act.error)}</Alert>}
      <dl className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Status</dt>
          <dd>
            <Badge tone={JOURNAL_STATUS_TONE[j.status]}>{JOURNAL_STATUS_LABEL[j.status]}</Badge>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Date</dt>
          <dd>{j.date}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Source</dt>
          <dd>{SOURCE_LABEL[j.source]}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Amount</dt>
          <dd className="tabular-nums">{inr(j.total || debit)}</dd>
        </div>
      </dl>
      {j.status === 'PENDING_APPROVAL' && j.approvalRequestId && (
        <Alert tone="info">
          Waiting for approval.{' '}
          <Link href={`/approvals/${j.approvalRequestId}`} className="font-medium underline">
            See the approval
          </Link>
        </Alert>
      )}
      {j.reversesId && (
        <Alert tone="info">
          This reverses{' '}
          <Link href={`/finance/journals/${j.reversesId}`} className="font-medium underline">
            another journal
          </Link>
          .
        </Alert>
      )}
      {j.reversedById && (
        <Alert tone="info">
          This journal was reversed by{' '}
          <Link href={`/finance/journals/${j.reversedById}`} className="font-medium underline">
            a reversing journal
          </Link>
          .
        </Alert>
      )}
      <Table label="Journal lines">
        <thead>
          <tr>
            <Th>Account</Th>
            <Th>Note</Th>
            <Th className="text-right">Debit</Th>
            <Th className="text-right">Credit</Th>
          </tr>
        </thead>
        <tbody>
          {j.lines.map((l) => (
            <tr key={l.id}>
              <Td>
                {l.account.code} · {l.account.name}
              </Td>
              <Td>{l.narration}</Td>
              <Td className="text-right tabular-nums">{l.debit ? inr(l.debit) : ''}</Td>
              <Td className="text-right tabular-nums">{l.credit ? inr(l.credit) : ''}</Td>
            </tr>
          ))}
          <tr className="font-semibold">
            <Td>Total</Td>
            <Td />
            <Td className="text-right tabular-nums">{inr(debit)}</Td>
            <Td className="text-right tabular-nums">{inr(credit)}</Td>
          </tr>
        </tbody>
      </Table>
      {editing && (
        <JournalDialog
          companyId={j.companyId}
          journal={j}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      )}
      {reversing && (
        <ReverseDialog
          journal={j}
          onClose={() => setReversing(false)}
          onDone={(r) => router.push(`/finance/journals/${r.id}`)}
        />
      )}
    </>
  );
}

function ReverseDialog({
  journal,
  onClose,
  onDone,
}: {
  journal: Journal;
  onClose: () => void;
  onDone: (j: Journal) => void;
}) {
  const client = useQueryClient();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const reverse = useMutation({
    mutationFn: () =>
      apiFetch<Journal>(`/v1/finance/journals/${journal.id}/reverse`, { method: 'POST', body: { date } }),
    onSuccess: async (r) => {
      await client.invalidateQueries({ queryKey: financeKeys.all });
      onDone(r);
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Reverse journal"
      description="Posts a mirror journal that undoes this one. The original stays in the books, linked to its reversal."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={reverse.isPending} onClick={() => reverse.mutate()}>
            Post reversal
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {reverse.isError && <Alert tone="error">{errorMessage(reverse.error)}</Alert>}
        <Field id="reverse-date" label="Reversal date" hint="Must fall in open books.">
          <Input id="reverse-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
