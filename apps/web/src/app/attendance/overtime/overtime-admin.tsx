'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { hoursAndMinutes } from '@/lib/attendance';
import { advancedKeys, monthRange, type OvertimeRow, type OvertimeView } from '@/lib/attendance-advanced';
import { todayIso } from '@/lib/employees';
import { formatDate } from '@/lib/plan';
import { cn } from '@/lib/utils';
import { AttendanceTabs } from '../attendance-tabs';

const FILTERS = [
  { id: 'PENDING', label: 'Waiting for a decision' },
  { id: 'DECIDED', label: 'Decided' },
  { id: 'ALL', label: 'All' },
] as const;

export function OvertimeAdmin({ session }: { session: SessionView }) {
  const initial = monthRange(todayIso());
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [status, setStatus] = useState<(typeof FILTERS)[number]['id']>('PENDING');
  const [deciding, setDeciding] = useState<OvertimeRow | null>(null);
  const [notice, setNotice] = useState<string>();
  const list = useQuery({
    queryKey: advancedKeys.overtime(from, to, status),
    queryFn: () => apiFetch<OvertimeView>(`/v1/attendance/overtime?from=${from}&to=${to}&status=${status}`),
  });

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Hours worked beyond the day, after the rules you set. Approve what should be paid or compensated."
      />
      <AttendanceTabs session={session} active="/attendance/overtime" />
      {notice && <Alert tone="success">{notice}</Alert>}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Field id="ot-from" label="From">
            <Input id="ot-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
        </div>
        <div className="w-44">
          <Field id="ot-to" label="To">
            <Input id="ot-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <div role="group" aria-label="Show" className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={status === f.id}
              onClick={() => setStatus(f.id)}
              className={cn(
                'h-11 rounded-md border border-input px-3 font-medium',
                status === f.id ? 'border-primary bg-primary/10 text-primary' : 'bg-card',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <Alert tone="error">{errorMessage(list.error)}</Alert>
      ) : (
        <>
          <p className="text-[13px] text-muted-foreground">
            {list.data.needsApproval
              ? `${hoursAndMinutes(list.data.totals.pendingMinutes)} waiting for a decision · ${hoursAndMinutes(list.data.totals.approvedMinutes)} approved in this period.`
              : 'Overtime is counted automatically; approval is switched off in Rules.'}
          </p>
          {list.data.rows.length === 0 ? (
            <EmptyState title="No overtime here">Nothing in this period matches.</EmptyState>
          ) : (
            <Table label="Overtime">
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Date</Th>
                  <Th>Worked</Th>
                  <Th>Overtime</Th>
                  <Th>Decision</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((r) => (
                  <tr key={`${r.employeeId}:${r.date}`}>
                    <Td>
                      <b>{r.name}</b>
                      <div className="text-xs text-muted-foreground">{r.employeeCode}</div>
                    </Td>
                    <Td>{formatDate(r.date)}</Td>
                    <Td>{hoursAndMinutes(r.workedMinutes)}</Td>
                    <Td>{hoursAndMinutes(r.overtimeMinutes)}</Td>
                    <Td>
                      {r.decision === 'PENDING' && <Badge tone="warning">Waiting</Badge>}
                      {r.decision === 'AUTO' && <Badge tone="neutral">Counted</Badge>}
                      {r.decision === 'APPROVED' && (
                        <Badge tone="success">Approved {hoursAndMinutes(r.approvedMinutes)}</Badge>
                      )}
                      {r.decision === 'REJECTED' && <Badge tone="danger">Rejected</Badge>}
                      {r.note && <div className="text-xs text-muted-foreground">{r.note}</div>}
                    </Td>
                    <Td className="text-right">
                      {list.data.needsApproval && (
                        <Button variant="outline" onClick={() => setDeciding(r)}>
                          {r.decision === 'PENDING' ? 'Decide' : 'Change'}
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
      {deciding && (
        <DecideDialog
          row={deciding}
          onClose={() => setDeciding(null)}
          onDone={(text) => {
            setDeciding(null);
            setNotice(text);
          }}
        />
      )}
    </>
  );
}

function DecideDialog({
  row,
  onClose,
  onDone,
}: {
  row: OvertimeRow;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const client = useQueryClient();
  const [minutes, setMinutes] = useState(String(row.approvedMinutes || row.overtimeMinutes));
  const [note, setNote] = useState(row.note ?? '');
  const [error, setError] = useState<string>();
  const decide = useMutation({
    mutationFn: (decision: 'APPROVED' | 'REJECTED') =>
      apiFetch<{ approvedMinutes: number }>('/v1/attendance/overtime/decide', {
        method: 'POST',
        body: {
          employeeId: row.employeeId,
          date: row.date,
          decision,
          ...(decision === 'APPROVED' ? { minutes: Number(minutes) } : {}),
          ...(note.trim() ? { note } : {}),
        },
      }),
    onSuccess: async (r, decision) => {
      await client.invalidateQueries({ queryKey: ['attendance', 'overtime'] });
      onDone(
        decision === 'APPROVED'
          ? `Approved ${hoursAndMinutes(r.approvedMinutes)} for ${row.name}.`
          : `Rejected the overtime for ${row.name}.`,
      );
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const valid =
    Number.isInteger(Number(minutes)) && Number(minutes) >= 1 && Number(minutes) <= row.overtimeMinutes;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${row.name} · ${formatDate(row.date)}`}
      description={`${hoursAndMinutes(row.overtimeMinutes)} of overtime worked.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={decide.isPending} onClick={() => decide.mutate('REJECTED')}>
            Reject
          </Button>
          <Button disabled={decide.isPending || !valid} onClick={() => decide.mutate('APPROVED')}>
            Approve
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alert tone="error">{error}</Alert>}
        <Field
          id="ot-minutes"
          label="Minutes to approve"
          hint={`Up to ${row.overtimeMinutes}. Approve fewer minutes if only part was authorised.`}
          error={valid ? undefined : `Enter a number from 1 to ${row.overtimeMinutes}`}
        >
          <Input
            id="ot-minutes"
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </Field>
        <Field id="ot-note" label="Note (optional)">
          <Input id="ot-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
