'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ReauthPrompt } from '@/components/reauth-prompt';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { ApiError, apiFetch, type SessionView } from '@/lib/api';
import {
  downloadFile,
  payrollKeys,
  rupees,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  usePayrollRun,
  type Adjustment,
  type PayrollRun,
} from '@/lib/payroll';

type Slip = PayrollRun['payslips'][number];

export function RunDetail({ id, session }: { id: string; session: SessionView }) {
  const run = usePayrollRun(id);
  const client = useQueryClient();
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const [editing, setEditing] = useState<Slip | null>(null);
  const [viewing, setViewing] = useState<Slip | null>(null);
  const [reauthFor, setReauthFor] = useState<string | null>(null);
  const save = (r: PayrollRun) => client.setQueryData(payrollKeys.run(id), r);
  const act = useMutation({
    mutationFn: (action: 'recalculate' | 'submit' | 'paid' | 'cancel') =>
      apiFetch<PayrollRun>(`/v1/payroll/runs/${id}/${action}`, { method: 'POST' }),
    onSuccess: async (r, action) => {
      save(r);
      await client.invalidateQueries({ queryKey: payrollKeys.runs });
      setNotice({
        tone: 'success',
        text: {
          recalculate: 'Recalculated.',
          submit: 'Sent for approval.',
          paid: 'Marked as paid.',
          cancel: 'Run cancelled.',
        }[action],
      });
    },
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  });
  const download = async (file: string) => {
    try {
      await downloadFile(`/v1/payroll/runs/${id}/${file}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'REAUTH_REQUIRED') setReauthFor(file);
      else setNotice({ tone: 'error', text: errorMessage(e) });
    }
  };

  if (run.isPending) return <Loading />;
  if (run.isError) return <Alert tone="error">{errorMessage(run.error)}</Alert>;
  const r = run.data;
  const warnings = r.payslips.filter((p) => p.warnings.length || p.net < 0);

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[13px]">
        <Link href="/payroll" className="text-primary hover:underline">
          Payroll
        </Link>{' '}
        <span className="text-muted-foreground">
          / {r.period}, {r.company.name}
        </span>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight">Payroll for {r.period}</h1>
          <p className="text-muted-foreground">
            {r.company.name} · {r.employeeCount} people
          </p>
          <span>
            <Badge tone={RUN_STATUS_TONE[r.status]}>{RUN_STATUS_LABEL[r.status]}</Badge>
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {r.can.edit && (
            <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate('recalculate')}>
              Recalculate
            </Button>
          )}
          {r.can.submit && (
            <Button disabled={act.isPending} onClick={() => act.mutate('submit')}>
              Send for approval
            </Button>
          )}
          {r.can.markPaid && (
            <Button disabled={act.isPending} onClick={() => act.mutate('paid')}>
              Mark as paid
            </Button>
          )}
          {r.can.cancel && (
            <Button variant="ghost" disabled={act.isPending} onClick={() => act.mutate('cancel')}>
              Cancel run
            </Button>
          )}
        </div>
      </header>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {r.status === 'PENDING_APPROVAL' && (
        <Alert tone="info">
          Waiting for approval.{' '}
          {r.approvalRequestId && (
            <Link href={`/approvals/${r.approvalRequestId}`} className="font-semibold underline">
              Open the approval
            </Link>
          )}
        </Alert>
      )}
      {warnings.length > 0 && r.status === 'DRAFT' && (
        <Alert tone="warning">{warnings.length} payslip(s) need a look: deductions are more than pay.</Alert>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ['Gross pay', r.gross],
            ['Deductions', r.deductions],
            ['Net pay', r.net],
            ['Cost to company', r.employerCost],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border bg-card p-4">
            <dt className="text-[13px] text-muted-foreground">{label}</dt>
            <dd className="text-[22px] font-semibold tabular-nums">{rupees(value)}</dd>
          </div>
        ))}
      </dl>

      {r.can.export && (
        <section aria-label="Files" className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => download('register.csv')}>
            Payroll register
          </Button>
          <Button variant="outline" onClick={() => download('bank.csv')}>
            Bank transfer list
          </Button>
          <Button variant="outline" onClick={() => download('pf-ecr.txt')}>
            PF return (ECR)
          </Button>
        </section>
      )}
      {reauthFor && (
        <ReauthPrompt
          reason="The bank transfer list has full account numbers. Confirm it’s you."
          mfaEnabled={session.user.mfaEnabled}
          onCancel={() => setReauthFor(null)}
          onDone={() => {
            const file = reauthFor;
            setReauthFor(null);
            void download(file);
          }}
        />
      )}

      <Table label="Payslips">
        <thead>
          <tr>
            <Th>Employee</Th>
            <Th className="text-right">Paid days</Th>
            <Th className="text-right">Gross</Th>
            <Th className="text-right">Deductions</Th>
            <Th className="text-right">Net pay</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {r.payslips.map((p) => (
            <tr key={p.id}>
              <Td>
                <Link
                  href={`/employees/${p.employee.id}?tab=pay`}
                  className="font-medium text-primary hover:underline"
                >
                  {p.employee.name}
                </Link>
                <span className="block font-mono text-xs text-muted-foreground">
                  {p.employee.employeeCode}
                </span>
              </Td>
              <Td className="text-right tabular-nums">
                {p.paidDays}
                {p.lopDays > 0 && (
                  <span className="block text-xs text-muted-foreground">{p.lopDays} LOP</span>
                )}
              </Td>
              <Td className="text-right tabular-nums">{rupees(p.gross)}</Td>
              <Td className="text-right tabular-nums">{rupees(p.totalDeductions)}</Td>
              <Td
                className={
                  p.net < 0 ? 'text-right font-medium text-danger tabular-nums' : 'text-right tabular-nums'
                }
              >
                {rupees(p.net)}
              </Td>
              <Td className="text-right">
                <span className="inline-flex gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Details for ${p.employee.name}`}
                    onClick={() => setViewing(p)}
                  >
                    Details
                  </Button>
                  {r.can.edit && (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Correct ${p.employee.name}`}
                      onClick={() => setEditing(p)}
                    >
                      Correct
                    </Button>
                  )}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {viewing && <SlipDialog slip={viewing} onClose={() => setViewing(null)} />}
      {editing && (
        <CorrectDialog
          slip={editing}
          onClose={() => setEditing(null)}
          onDone={(next) => {
            save(next);
            setEditing(null);
            setNotice({ tone: 'success', text: 'Payslip corrected and the run recalculated.' });
          }}
        />
      )}
    </>
  );
}

function SlipDialog({ slip, onClose }: { slip: Slip; onClose: () => void }) {
  const section = (title: string, lines: { name: string; amount: number }[]) => (
    <section aria-label={title}>
      <h3 className="mb-1 text-[13px] font-semibold">{title}</h3>
      <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-0.5 text-sm">
        {lines.map((l, i) => (
          <div key={i} className="contents">
            <dt>{l.name}</dt>
            <dd className="text-right tabular-nums">{rupees(l.amount)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${slip.employee.name}: payslip`}
      description={`${slip.paidDays} paid days${slip.lopDays ? `, ${slip.lopDays} loss of pay` : ''}`}
    >
      <div className="flex flex-col gap-4">
        {section('Earnings', slip.earnings)}
        {section('Deductions', slip.deductions)}
        {section('Paid by the company', slip.employer)}
        <p className="text-sm font-semibold">Net pay {rupees(slip.net)}</p>
        {slip.tds && (
          <p className="text-xs text-muted-foreground">
            Income tax: projected taxable income {rupees(slip.tds.projectedAnnualTaxable)} for the year, tax{' '}
            {rupees(slip.tds.annualTax)}, {rupees(slip.tds.deductedBefore)} deducted earlier, spread over{' '}
            {slip.tds.monthsLeft} month(s).
          </p>
        )}
      </div>
    </Dialog>
  );
}

function CorrectDialog({
  slip,
  onClose,
  onDone,
}: {
  slip: Slip;
  onClose: () => void;
  onDone: (r: PayrollRun) => void;
}) {
  const [lop, setLop] = useState(slip.lopOverride === null ? '' : String(slip.lopOverride));
  const [lines, setLines] = useState<(Omit<Adjustment, 'amount'> & { amount: string })[]>(
    slip.adjustments.map((a) => ({ ...a, amount: String(a.amount) })),
  );
  const m = useMutation({
    mutationFn: () =>
      apiFetch<PayrollRun>(`/v1/payroll/payslips/${slip.id}`, {
        method: 'PATCH',
        body: {
          lopOverride: lop === '' ? null : Number(lop),
          adjustments: lines.map((l) => ({ ...l, amount: Number(l.amount) })),
        },
      }),
    onSuccess: onDone,
  });
  const set = (i: number, patch: Partial<(typeof lines)[number]>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Correct ${slip.employee.name}’s payslip`}
      description={`Attendance says ${slip.lopOverride === null ? slip.lopDays : '—'} day(s) of loss of pay. Leave blank to follow attendance.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={m.isPending} onClick={() => m.mutate()}>
            Save and recalculate
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {m.isError && <Alert tone="error">{errorMessage(m.error)}</Alert>}
        <Field id="lop" label="Loss of pay days (optional)">
          <Input id="lop" inputMode="decimal" value={lop} onChange={(e) => setLop(e.target.value)} />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">One-off lines</legend>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_8rem_auto] items-end gap-2">
              <Field id={`adj-name-${i}`} label="What for">
                <Input
                  id={`adj-name-${i}`}
                  value={l.name}
                  onChange={(e) => set(i, { name: e.target.value })}
                />
              </Field>
              <Field id={`adj-kind-${i}`} label="Kind">
                <Select
                  id={`adj-kind-${i}`}
                  value={l.kind}
                  onChange={(e) => set(i, { kind: e.target.value as Adjustment['kind'] })}
                >
                  <option value="EARNING">Pay</option>
                  <option value="DEDUCTION">Deduction</option>
                </Select>
              </Field>
              <Field id={`adj-amount-${i}`} label="Amount">
                <Input
                  id={`adj-amount-${i}`}
                  inputMode="decimal"
                  value={l.amount}
                  onChange={(e) => set(i, { amount: e.target.value })}
                />
              </Field>
              <Button
                variant="ghost"
                aria-label={`Remove line ${i + 1}`}
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            className="self-start"
            onClick={() =>
              setLines((ls) => [...ls, { name: '', kind: 'EARNING', amount: '', taxable: true }])
            }
          >
            <Plus className="size-4" /> Add a line
          </Button>
        </fieldset>
      </div>
    </Dialog>
  );
}
