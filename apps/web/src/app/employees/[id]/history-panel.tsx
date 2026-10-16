'use client';

import { Alert } from '@/components/ui/alert';
import { EmptyState, Loading } from '@/components/ui/page-header';
import { errorMessage } from '@/lib/admin';
import {
  CHANGE_LABEL,
  EVENT_LABEL,
  formatDay,
  STATUS_LABEL,
  useEmployeeHistory,
  type EmployeeStatus,
} from '@/lib/employees';

function show(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'none';
  if (field === 'status' && typeof value === 'string' && value in STATUS_LABEL)
    return STATUS_LABEL[value as EmployeeStatus];
  if (field === 'lastWorkingDay' && typeof value === 'string') return formatDay(value);
  if (field === 'signIn') return value === 'SUSPENDED' ? 'suspended' : 'active';
  return typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value);
}

/** The append-only employment history: what changed, from what to what, effective when, recorded by whom. */
export function HistoryPanel({ id }: { id: string }) {
  const history = useEmployeeHistory(id);
  if (history.isPending) return <Loading />;
  if (history.isError) return <Alert tone="error">{errorMessage(history.error)}</Alert>;
  if (history.data.length === 0) return <EmptyState title="No history yet" />;
  return (
    <ol aria-label="Employment history" className="flex flex-col">
      {history.data.map((h) => (
        <li key={h.id} className="grid grid-cols-[112px_1fr] gap-4 border-l-2 border-border py-3 pl-4">
          <span className="text-[13px] tabular-nums text-muted-foreground">{formatDay(h.effectiveDate)}</span>
          <div className="flex flex-col gap-1">
            <strong>{EVENT_LABEL[h.kind]}</strong>
            {Object.keys(h.changes).length > 0 && (
              <ul className="text-[13px]">
                {Object.entries(h.changes).map(([field, change]) => (
                  <li key={field}>
                    {CHANGE_LABEL[field] ?? field}:{' '}
                    {change.from === null || change.from === undefined ? (
                      show(field, change.to)
                    ) : (
                      <>
                        {show(field, change.from)} → {show(field, change.to)}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {h.note && <p className="text-[13px] text-muted-foreground">“{h.note}”</p>}
            <span className="text-xs text-muted-foreground">
              Recorded{' '}
              {new Date(h.recordedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              {h.recordedBy ? ` by ${h.recordedBy}` : ''}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
