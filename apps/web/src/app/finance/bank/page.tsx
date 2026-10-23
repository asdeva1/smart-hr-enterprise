'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseBankCsv, type ParsedBankStatement } from '@smart-hr/validation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import {
  bankKeys,
  type BankAccountOption,
  type BankLine,
  type BankStatementRow,
  type BankSummary,
  type BookItem,
} from '@/lib/bank';
import { inr, useBooksCompany } from '@/lib/finance';
import { formatDate } from '@/lib/plan';
import { can } from '@/lib/permissions';
import { CompanyPicker, FinancePage } from '../finance-page';

const VIEWS = [
  { value: 'UNMATCHED', label: 'To match' },
  { value: 'MATCHED', label: 'Matched' },
  { value: 'IGNORED', label: 'Set aside' },
  { value: 'BOOKS', label: 'In books, not in bank' },
] as const;
type View = (typeof VIEWS)[number]['value'];

export default function BankReconciliationPage() {
  return (
    <FinancePage active="Bank reconciliation">
      {(session) => <Bank canManage={can(session, 'finance.manage')} />}
    </FinancePage>
  );
}

function Bank({ canManage }: { canManage: boolean }) {
  const [companyId, setCompanyId] = useBooksCompany();
  const [picked, setPicked] = useState('');
  const [view, setView] = useState<View>('UNMATCHED');
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const accounts = useQuery({
    queryKey: [...bankKeys.all, 'accounts', companyId],
    enabled: !!companyId,
    queryFn: () => apiFetch<BankAccountOption[]>(`/v1/finance/bank/accounts?companyId=${companyId}`),
  });
  const options = accounts.data ?? [];
  const accountId = options.some((a) => a.id === picked) ? picked : (options[0]?.id ?? '');
  const qs = `companyId=${companyId}&accountId=${accountId}`;
  return (
    <>
      <PageHeader
        title="Bank reconciliation"
        description="Import your bank statement and match each line to an entry in your books. The bank balance and the books agree once nothing is left to match."
      />
      <div className="flex flex-wrap items-end gap-4">
        <CompanyPicker value={companyId} onChange={setCompanyId} />
        <Field id="bank-account" label="Bank account">
          <Select id="bank-account" value={accountId} onChange={(e) => setPicked(e.target.value)}>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="bank-asof" label="As of">
          <Input
            id="bank-asof"
            type="date"
            value={asOf}
            onChange={(e) => e.target.value && setAsOf(e.target.value)}
          />
        </Field>
      </div>
      {!companyId || accounts.isPending ? (
        <Loading />
      ) : !accountId ? (
        <EmptyState title="No bank account" />
      ) : (
        <>
          <Summary qs={qs} asOf={asOf} />
          {canManage && <Import companyId={companyId} accountId={accountId} />}
          <Tabs label="Statement lines" value={view} onChange={setView} options={[...VIEWS]} />
          {view === 'BOOKS' ? (
            <BookOnly qs={qs} asOf={asOf} />
          ) : (
            <Lines qs={qs} status={view} canManage={canManage} companyId={companyId} accountId={accountId} />
          )}
          <Statements qs={qs} />
        </>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'ok' | 'bad';
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <b
        className={`text-xl tabular-nums ${tone === 'bad' ? 'text-danger' : tone === 'ok' ? 'text-success' : ''}`}
      >
        {value}
      </b>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function Summary({ qs, asOf }: { qs: string; asOf: string }) {
  const q = useQuery({
    queryKey: [...bankKeys.all, 'summary', qs, asOf],
    queryFn: () => apiFetch<BankSummary>(`/v1/finance/bank/summary?${qs}&asOf=${asOf}`),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <Alert tone="error">{errorMessage(q.error)}</Alert>;
  const s = q.data;
  return (
    <section aria-label="Reconciliation summary" className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Balance in your books" value={inr(s.bookBalance)} hint={`As of ${formatDate(s.asOf)}`} />
        <Stat
          label="Balance on the statement"
          value={s.statementBalance === null ? 'Not known' : inr(s.statementBalance)}
          hint={
            s.statementDate
              ? `Statement to ${formatDate(s.statementDate)}`
              : 'Import a statement with a closing balance'
          }
        />
        <Stat
          label="On the bank only"
          value={`${s.bankOnly.count} line${s.bankOnly.count === 1 ? '' : 's'}`}
          hint={`${inr(s.bankOnly.deposits)} in, ${inr(s.bankOnly.withdrawals)} out. Book them, then match.`}
        />
        <Stat
          label="In your books only"
          value={`${s.bookOnly.count} entr${s.bookOnly.count === 1 ? 'y' : 'ies'}`}
          hint={`${inr(s.bookOnly.inTransit)} not yet received, ${inr(s.bookOnly.uncleared)} not yet cleared`}
        />
      </div>
      {s.difference === null ? (
        <Alert tone="info">
          Import a statement that has a closing balance to see whether the books agree with the bank.
        </Alert>
      ) : s.reconciled ? (
        <Alert tone="success">
          {s.bankOnly.count > 0
            ? `The bank and the books agree at ${inr(s.adjustedBook)} once the ${s.bankOnly.count} bank-only line${s.bankOnly.count === 1 ? ' is' : 's are'} booked.`
            : `Reconciled. The bank and the books agree at ${inr(s.adjustedBook)}.`}
        </Alert>
      ) : (
        <Alert tone="warning">
          Not reconciled yet. Adjusted bank balance {inr(s.adjustedBank ?? 0)}, adjusted books{' '}
          {inr(s.adjustedBook)}: difference {inr(s.difference)}.
        </Alert>
      )}
    </section>
  );
}

function Import({ companyId, accountId }: { companyId: string; accountId: string }) {
  const client = useQueryClient();
  const [parsed, setParsed] = useState<{ name: string; result: ParsedBankStatement }>();
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const importIt = useMutation({
    mutationFn: (p: { name: string; result: ParsedBankStatement }) =>
      apiFetch<{ imported: number; duplicates: number }>('/v1/finance/bank/statements', {
        method: 'POST',
        body: {
          companyId,
          accountId,
          fileName: p.name,
          openingBalance: p.result.openingBalance,
          closingBalance: p.result.closingBalance,
          lines: p.result.lines,
        },
      }),
    onSuccess: async (r) => {
      setParsed(undefined);
      setNotice({
        tone: 'success',
        text: `Imported ${r.imported} line${r.imported === 1 ? '' : 's'}${r.duplicates ? `; ${r.duplicates} already imported were skipped` : ''}.`,
      });
      await client.invalidateQueries({ queryKey: bankKeys.all });
    },
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  });
  const auto = useMutation({
    mutationFn: () =>
      apiFetch<{ matched: number; remaining: number }>('/v1/finance/bank/auto-match', {
        method: 'POST',
        body: { companyId, accountId },
      }),
    onSuccess: async (r) => {
      setNotice({
        tone: 'success',
        text: `Matched ${r.matched} line${r.matched === 1 ? '' : 's'}. ${r.remaining} left for you to check.`,
      });
      await client.invalidateQueries({ queryKey: bankKeys.all });
    },
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  });
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
      <h2 className="text-[15px] font-semibold">Bring in a statement</h2>
      <p className="text-sm text-muted-foreground">
        Download the statement from your bank as a CSV file. It needs a Date column, a Narration or
        Description column, and Debit and Credit columns (or one Amount column).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field id="bank-file" label="Statement file (CSV)">
          <Input
            id="bank-file"
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              setNotice(undefined);
              if (!file) return setParsed(undefined);
              setParsed({ name: file.name, result: parseBankCsv(await file.text()) });
            }}
          />
        </Field>
        <Button variant="outline" disabled={auto.isPending} onClick={() => auto.mutate()}>
          Match automatically
        </Button>
      </div>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {parsed && parsed.result.errors.length > 0 && (
        <Alert tone="error">
          <b>Fix the file and choose it again.</b>
          <ul className="mt-1 ml-4 list-disc">
            {parsed.result.errors.slice(0, 8).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Alert>
      )}
      {parsed && parsed.result.errors.length === 0 && (
        <div className="flex flex-col gap-2">
          <p>
            <b>{parsed.result.lines.length}</b> lines from {formatDate(parsed.result.lines[0]?.date)} to{' '}
            {formatDate(parsed.result.lines[parsed.result.lines.length - 1]?.date)}
            {parsed.result.closingBalance !== null && (
              <>, closing balance {inr(parsed.result.closingBalance)}</>
            )}
            .
          </p>
          <div>
            <Button disabled={importIt.isPending} onClick={() => importIt.mutate(parsed)}>
              Import {parsed.result.lines.length} lines
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function BookText({ b }: { b: BookItem }) {
  return (
    <span>
      {b.entryNumber ?? 'Journal'} · {formatDate(b.date)} · {b.narration}{' '}
      <span className="tabular-nums">({inr(b.debit || b.credit)})</span>
    </span>
  );
}

function Lines({
  qs,
  status,
  canManage,
  companyId,
  accountId,
}: {
  qs: string;
  status: 'UNMATCHED' | 'MATCHED' | 'IGNORED';
  canManage: boolean;
  companyId: string;
  accountId: string;
}) {
  const client = useQueryClient();
  const [error, setError] = useState<string>();
  const lines = useQuery({
    queryKey: [...bankKeys.all, 'lines', qs, status],
    queryFn: () => apiFetch<BankLine[]>(`/v1/finance/bank/lines?${qs}&status=${status}`),
  });
  const act = useMutation({
    mutationFn: (r: { path: string; body?: unknown }) =>
      apiFetch(`/v1/finance/bank/lines/${r.path}`, { method: 'POST', ...(r.body ? { body: r.body } : {}) }),
    onSuccess: async () => {
      setError(undefined);
      await client.invalidateQueries({ queryKey: bankKeys.all });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  void companyId;
  void accountId;
  if (lines.isPending) return <Loading />;
  if (lines.isError) return <Alert tone="error">{errorMessage(lines.error)}</Alert>;
  if (lines.data.length === 0) {
    return (
      <EmptyState
        title={
          status === 'UNMATCHED'
            ? 'Nothing to match'
            : status === 'MATCHED'
              ? 'Nothing matched yet'
              : 'Nothing set aside'
        }
      >
        {status === 'UNMATCHED' && 'Import a statement above, or everything is already matched.'}
      </EmptyState>
    );
  }
  return (
    <>
      {error && <Alert tone="error">{error}</Alert>}
      <Table label="Statement lines">
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Narration</Th>
            <Th className="text-right">In</Th>
            <Th className="text-right">Out</Th>
            <Th>{status === 'UNMATCHED' ? 'Match with' : status === 'MATCHED' ? 'Matched to' : 'Note'}</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {lines.data.map((l) => (
            <tr key={l.id}>
              <Td className="whitespace-nowrap">{formatDate(l.date)}</Td>
              <Td>
                {l.description}
                {l.reference && <div className="text-xs text-muted-foreground">Ref {l.reference}</div>}
              </Td>
              <Td className="text-right tabular-nums">{l.deposit ? inr(l.deposit) : ''}</Td>
              <Td className="text-right tabular-nums">{l.withdrawal ? inr(l.withdrawal) : ''}</Td>
              <Td>
                {status === 'UNMATCHED' ? (
                  l.suggestions.length === 0 ? (
                    <span className="text-muted-foreground">
                      No entry in the books yet. Post a journal for it, then match.
                    </span>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {l.suggestions.map((s) => (
                        <li key={s.journalLineId} className="flex flex-wrap items-center gap-2">
                          <BookText b={s} />
                          {canManage && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={act.isPending}
                              onClick={() =>
                                act.mutate({
                                  path: `${l.id}/match`,
                                  body: { journalLineId: s.journalLineId },
                                })
                              }
                            >
                              Match
                              <span className="sr-only">
                                {' '}
                                {l.description} with {s.entryNumber}
                              </span>
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )
                ) : status === 'MATCHED' ? (
                  l.match && <BookText b={l.match} />
                ) : (
                  (l.note ?? '—')
                )}
              </Td>
              <Td>
                {canManage &&
                  (status === 'UNMATCHED' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={act.isPending}
                      onClick={() => act.mutate({ path: `${l.id}/ignore`, body: { note: 'Set aside' } })}
                    >
                      Set aside
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={act.isPending}
                      onClick={() => act.mutate({ path: `${l.id}/unmatch` })}
                    >
                      {status === 'MATCHED' ? 'Unmatch' : 'Bring back'}
                    </Button>
                  ))}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

function BookOnly({ qs, asOf }: { qs: string; asOf: string }) {
  const q = useQuery({
    queryKey: [...bankKeys.all, 'book-items', qs, asOf],
    queryFn: () => apiFetch<BookItem[]>(`/v1/finance/bank/book-items?${qs}&to=${asOf}`),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <Alert tone="error">{errorMessage(q.error)}</Alert>;
  if (q.data.length === 0) return <EmptyState title="Every entry in your books is on the statement" />;
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Cheques not yet cleared and deposits not yet received show here until a statement line matches them.
      </p>
      <Table label="Entries not on the statement">
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Entry</Th>
            <Th>Narration</Th>
            <Th className="text-right">Received</Th>
            <Th className="text-right">Paid</Th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((b) => (
            <tr key={b.journalLineId}>
              <Td className="whitespace-nowrap">{formatDate(b.date)}</Td>
              <Td>{b.entryNumber ?? '—'}</Td>
              <Td>{b.narration}</Td>
              <Td className="text-right tabular-nums">{b.debit ? inr(b.debit) : ''}</Td>
              <Td className="text-right tabular-nums">{b.credit ? inr(b.credit) : ''}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

function Statements({ qs }: { qs: string }) {
  const q = useQuery({
    queryKey: [...bankKeys.all, 'statements', qs],
    queryFn: () => apiFetch<BankStatementRow[]>(`/v1/finance/bank/statements?${qs}`),
  });
  if (!q.data || q.data.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[15px] font-semibold">Statements imported</h2>
      <Table label="Imported statements">
        <thead>
          <tr>
            <Th>File</Th>
            <Th>Period</Th>
            <Th className="text-right">Lines</Th>
            <Th className="text-right">Closing balance</Th>
            <Th>
              <Badge>Imported</Badge>
            </Th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((s) => (
            <tr key={s.id}>
              <Td>{s.fileName}</Td>
              <Td>
                {formatDate(s.periodFrom)} to {formatDate(s.periodTo)}
              </Td>
              <Td className="text-right tabular-nums">{s.lineCount}</Td>
              <Td className="text-right tabular-nums">
                {s.closingBalance === null ? '—' : inr(s.closingBalance)}
              </Td>
              <Td>{formatDate(s.importedAt)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}
