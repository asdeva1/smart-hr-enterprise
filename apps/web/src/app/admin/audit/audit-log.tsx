'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { adminKeys, errorMessage, formatDateTime, type AuditEvent } from '@/lib/admin';
import { apiFetch } from '@/lib/api';

const CATEGORIES = [
  { value: '', label: 'Everything' },
  { value: 'auth.', label: 'Sign-in and account security' },
  { value: 'access.', label: 'People, roles and ownership' },
  { value: 'org.', label: 'Organisation structure' },
  { value: 'security.', label: 'Security policy' },
  { value: 'tenant.', label: 'Organisation settings' },
];

const OUTCOME_TONE = { SUCCESS: 'success', FAILURE: 'warning', DENIED: 'danger' } as const;

function describe(action: string): string {
  return action.replaceAll('.', ' › ').replaceAll('_', ' ');
}

export function AuditLog() {
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState('');
  const filters = { action, outcome };

  const log = useInfiniteQuery({
    queryKey: adminKeys.audit(filters),
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      apiFetch<{ items: AuditEvent[]; nextBefore: string | null }>(
        `/v1/admin/audit?${new URLSearchParams({
          limit: '50',
          ...(action ? { action } : {}),
          ...(outcome ? { outcome } : {}),
          ...(pageParam ? { before: pageParam } : {}),
        }).toString()}`,
      ),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  const events = log.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader
        title="Audit log"
        description="An append-only record of security and administrative actions. Entries can’t be edited or deleted."
      />
      <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <Field id="audit-category" label="Show">
          <Select id="audit-category" value={action} onChange={(e) => setAction(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="audit-outcome" label="Outcome">
          <Select id="audit-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Any</option>
            <option value="SUCCESS">Succeeded</option>
            <option value="FAILURE">Failed</option>
            <option value="DENIED">Denied</option>
          </Select>
        </Field>
      </div>
      {log.isPending ? (
        <Loading />
      ) : log.isError ? (
        <Alert tone="error">{errorMessage(log.error)}</Alert>
      ) : events.length === 0 ? (
        <EmptyState title="No matching events" />
      ) : (
        <>
          <Table label="Audit events">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>What</Th>
                <Th>Outcome</Th>
                <Th>Target</Th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatDateTime(e.occurredAt)}</Td>
                  <Td>
                    {e.actor ? e.actor.displayName : <span className="text-muted-foreground">System</span>}
                  </Td>
                  <Td className="capitalize">{describe(e.action)}</Td>
                  <Td>
                    <Badge tone={OUTCOME_TONE[e.outcome]}>{e.outcome.toLowerCase()}</Badge>
                  </Td>
                  <Td className="text-muted-foreground">
                    {e.targetType ? (
                      <>
                        {e.targetType.replaceAll('_', ' ')}{' '}
                        <span className="font-mono text-xs">{e.targetId?.slice(0, 8)}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {log.hasNextPage && (
            <div>
              <Button
                variant="outline"
                disabled={log.isFetchingNextPage}
                onClick={() => void log.fetchNextPage()}
              >
                {log.isFetchingNextPage ? 'Loading…' : 'Load older events'}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
