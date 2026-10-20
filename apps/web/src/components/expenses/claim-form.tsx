'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { expenseKeys, useExpenseCategories, type Claim } from '@/lib/expenses';

interface Row {
  key: number;
  date: string;
  categoryId: string;
  description: string;
  amount: string;
  receiptNumber: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const blank = (key: number): Row => ({
  key,
  date: today(),
  categoryId: '',
  description: '',
  amount: '',
  receiptNumber: '',
});

/** Write or change a draft expense claim: a title and one line for each thing paid for. */
export function ClaimDialog({
  claim,
  onClose,
  onSaved,
}: {
  claim?: Claim;
  onClose: () => void;
  onSaved: (c: Claim) => void;
}) {
  const categories = useExpenseCategories();
  const client = useQueryClient();
  const [title, setTitle] = useState(claim?.title ?? '');
  const [seq, setSeq] = useState(10);
  const [rows, setRows] = useState<Row[]>(
    claim
      ? claim.lines.map((l, i) => ({
          key: i,
          date: l.date,
          categoryId: l.categoryId,
          description: l.description,
          amount: String(l.amount),
          receiptNumber: l.receiptNumber ?? '',
        }))
      : [blank(0)],
  );
  const active = (categories.data ?? []).filter((c) => c.status === 'ACTIVE');
  const total = rows.reduce((s, r) => s + Math.round((Number(r.amount) || 0) * 100), 0) / 100;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title,
        lines: rows.map((r) => ({
          date: r.date,
          categoryId: r.categoryId,
          description: r.description,
          amount: Number(r.amount),
          receiptNumber: r.receiptNumber,
        })),
      };
      return claim
        ? apiFetch<Claim>(`/v1/expenses/claims/${claim.id}`, { method: 'PUT', body })
        : apiFetch<Claim>('/v1/expenses/claims', { method: 'POST', body });
    },
    onSuccess: async (c) => {
      await client.invalidateQueries({ queryKey: expenseKeys.all });
      onSaved(c);
    },
  });

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Dialog
      open
      onClose={onClose}
      title={claim ? 'Edit claim' : 'New expense claim'}
      description="List what you spent. Saving keeps it as a draft; send it for approval when it’s ready."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !title || total <= 0} onClick={() => save.mutate()}>
            Save draft
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <Field id="claim-title" label="What is this claim for?">
          <Input id="claim-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        {rows.map((r, i) => (
          <fieldset
            key={r.key}
            className="grid grid-cols-2 gap-2 rounded-md border border-border p-2 sm:grid-cols-[130px_1fr_110px]"
          >
            <legend className="sr-only">Expense {i + 1}</legend>
            <Input
              type="date"
              aria-label={`Expense ${i + 1} date`}
              value={r.date}
              onChange={(e) => update(r.key, { date: e.target.value })}
            />
            <Select
              aria-label={`Expense ${i + 1} category`}
              value={r.categoryId}
              onChange={(e) => update(r.key, { categoryId: e.target.value })}
            >
              <option value="">Choose a category</option>
              {active.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.requiresReceipt ? ' (receipt needed)' : ''}
                </option>
              ))}
            </Select>
            <Input
              aria-label={`Expense ${i + 1} amount`}
              inputMode="decimal"
              placeholder="Amount"
              className="text-right tabular-nums"
              value={r.amount}
              onChange={(e) => update(r.key, { amount: e.target.value })}
            />
            <Input
              aria-label={`Expense ${i + 1} description`}
              placeholder="What it was for"
              className="col-span-2 sm:col-span-2"
              value={r.description}
              onChange={(e) => update(r.key, { description: e.target.value })}
            />
            <div className="col-span-2 flex gap-2 sm:col-span-1">
              <Input
                aria-label={`Expense ${i + 1} receipt number`}
                placeholder="Receipt no."
                value={r.receiptNumber}
                onChange={(e) => update(r.key, { receiptNumber: e.target.value })}
              />
              <Button
                variant="outline"
                aria-label={`Remove expense ${i + 1}`}
                disabled={rows.length <= 1}
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          </fieldset>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setRows((rs) => [...rs, blank(seq)]);
              setSeq((s) => s + 1);
            }}
          >
            <Plus className="size-4" aria-hidden /> Add expense
          </Button>
          <p className="text-sm font-medium tabular-nums" aria-live="polite">
            Total {total.toFixed(2)}
          </p>
        </div>
      </div>
    </Dialog>
  );
}
