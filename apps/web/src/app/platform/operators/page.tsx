'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PlatformPage } from '@/components/platform/platform-page';
import { ReauthPrompt } from '@/components/reauth-prompt';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { ApiError, apiFetch, type SessionView } from '@/lib/api';
import { formatDate } from '@/lib/plan';
import { platformKeys, useOperators } from '@/lib/platform';

function Operators({ session }: { session: SessionView }) {
  const operators = useOperators();
  const client = useQueryClient();
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const [retry, setRetry] = useState<(() => void) | null>(null);

  const change = useMutation({
    mutationFn: (req: { method: 'POST' | 'DELETE'; path: string; body?: unknown; done: string }) =>
      apiFetch(req.path, { method: req.method, ...(req.body ? { body: req.body } : {}) }),
    onSuccess: async (_r, req) => {
      setNotice({ tone: 'success', text: req.done });
      setEmail('');
      await client.invalidateQueries({ queryKey: platformKeys.operators });
    },
    onError: (e, req) => {
      if (e instanceof ApiError && e.code === 'REAUTH_REQUIRED') setRetry(() => () => change.mutate(req));
      else setNotice({ tone: 'error', text: errorMessage(e) });
    },
  });

  return (
    <>
      <PageHeader
        title="Platform operators"
        description="People who can run the platform console: every organisation, the plan catalogue and other operators."
      />
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {retry && (
        <ReauthPrompt
          reason="Confirm it’s you before changing who can operate the platform."
          mfaEnabled={session.user.mfaEnabled}
          onCancel={() => setRetry(null)}
          onDone={() => {
            const again = retry;
            setRetry(null);
            again();
          }}
        />
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setNotice(undefined);
          change.mutate({
            method: 'POST',
            path: '/v1/platform/operators',
            body: { email },
            done: `${email} is now a platform operator.`,
          });
        }}
      >
        <Field id="operator-email" label="Add an operator (existing account’s email)">
          <Input
            id="operator-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={change.isPending || !email}>
          Add operator
        </Button>
      </form>
      {operators.isPending ? (
        <Loading />
      ) : operators.isError ? (
        <Alert tone="error">{errorMessage(operators.error)}</Alert>
      ) : (
        <Table label="Platform operators">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Two-step verification</Th>
              <Th>Last sign-in</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {operators.data.map((o) => (
              <tr key={o.id}>
                <Td className="font-medium">
                  {o.displayName}
                  {o.id === session.user.id && <span className="text-muted-foreground"> (you)</span>}
                </Td>
                <Td>{o.email}</Td>
                <Td>
                  {o.mfaEnabledAt ? <Badge tone="success">On</Badge> : <Badge tone="warning">Off</Badge>}
                </Td>
                <Td>{formatDate(o.lastLoginAt)}</Td>
                <Td className="text-right">
                  {o.id !== session.user.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={change.isPending}
                      onClick={() =>
                        change.mutate({
                          method: 'DELETE',
                          path: `/v1/platform/operators/${o.id}`,
                          done: `${o.email} is no longer a platform operator.`,
                        })
                      }
                    >
                      Remove<span className="sr-only"> {o.email}</span>
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

export default function PlatformOperatorsPage() {
  return <PlatformPage active="Operators">{(session) => <Operators session={session} />}</PlatformPage>;
}
