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
import { financeKeys, inr, useAccounts, type Journal } from '@/lib/finance';

interface Row {
  key: number;
  accountId: string;
  debit: string;
  credit: string;
  narration: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const paise = (v: string) => Math.round((Number(v) || 0) * 100);

/** Draft or edit a manual journal: a date, what it's for, and lines that must balance. */
export function JournalDialog({
  companyId,
  journal,
  onClose,
  onSaved,
}: {
  companyId: string;
  journal?: Journal;
  onClose: () => void;
  onSaved: (j: Journal) => void;
}) {
  const accounts = useAccounts(companyId);
  const client = useQueryClient();
  const [date, setDate] = useState(journal?.date ?? today());
  const [narration, setNarration] = useState(journal?.narration ?? '');
  const [seq, setSeq] = useState(10);
  const [rows, setRows] = useState<Row[]>(
    journal
      ? journal.lines.map((l, i) => ({
          key: i,
          accountId: l.account.id,
          debit: l.debit ? String(l.debit) : '',
          credit: l.credit ? String(l.credit) : '',
          narration: l.narration ?? '',
        }))
      : [
          { key: 0, accountId: '', debit: '', credit: '', narration: '' },
          { key: 1, accountId: '', debit: '', credit: '', narration: '' },
        ],
  );
  const debit = rows.reduce((s, r) => s + paise(r.debit), 0);
  const credit = rows.reduce((s, r) => s + paise(r.credit), 0);
  const active = (accounts.data ?? []).filter((a) => a.status === 'ACTIVE');

  const save = useMutation({
    mutationFn: () => {
      const body = {
        date,
        narration,
        lines: rows.map((r) => ({
          accountId: r.accountId,
          debit: Number(r.debit) || 0,
          credit: Number(r.credit) || 0,
          narration: r.narration,
        })),
      };
      return journal
        ? apiFetch<Journal>(`/v1/finance/journals/${journal.id}`, { method: 'PUT', body })
        : apiFetch<Journal>('/v1/finance/journals', { method: 'POST', body: { ...body, companyId } });
    },
    onSuccess: async (j) => {
      await client.invalidateQueries({ queryKey: financeKeys.all });
      onSaved(j);
    },
  });

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Dialog
      open
      onClose={onClose}
      title={journal ? 'Edit journal' : 'New journal'}
      description="Debits and credits must be equal. Saving keeps it as a draft; it posts to the books once someone else approves it."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || debit === 0 || debit !== credit} onClick={() => save.mutate()}>
            Save draft
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
          <Field id="journal-date" label="Date">
            <Input id="journal-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field id="journal-narration" label="What it’s for">
            <Input id="journal-narration" value={narration} onChange={(e) => setNarration(e.target.value)} />
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <fieldset
              key={r.key}
              className="grid grid-cols-2 gap-2 rounded-md border border-border p-2 sm:grid-cols-[1fr_120px_120px_auto]"
            >
              <legend className="sr-only">Line {i + 1}</legend>
              <Select
                aria-label={`Line ${i + 1} account`}
                className="col-span-2 sm:col-span-1"
                value={r.accountId}
                onChange={(e) => update(r.key, { accountId: e.target.value })}
              >
                <option value="">Choose an account</option>
                {active.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </Select>
              <Input
                aria-label={`Line ${i + 1} debit`}
                inputMode="decimal"
                placeholder="Debit"
                className="text-right tabular-nums"
                value={r.debit}
                onChange={(e) =>
                  update(r.key, { debit: e.target.value, ...(e.target.value ? { credit: '' } : {}) })
                }
              />
              <Input
                aria-label={`Line ${i + 1} credit`}
                inputMode="decimal"
                placeholder="Credit"
                className="text-right tabular-nums"
                value={r.credit}
                onChange={(e) =>
                  update(r.key, { credit: e.target.value, ...(e.target.value ? { debit: '' } : {}) })
                }
              />
              <Button
                variant="outline"
                aria-label={`Remove line ${i + 1}`}
                disabled={rows.length <= 2}
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </fieldset>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setRows((rs) => [...rs, { key: seq, accountId: '', debit: '', credit: '', narration: '' }]);
                setSeq((s) => s + 1);
              }}
            >
              <Plus className="size-4" aria-hidden /> Add line
            </Button>
            <p className="text-sm tabular-nums" aria-live="polite">
              Debits {inr(debit / 100)} · Credits {inr(credit / 100)}
              {debit !== credit && (
                <span className="ml-2 font-medium text-danger">
                  Off by {inr(Math.abs(debit - credit) / 100)}
                </span>
              )}
            </p>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
