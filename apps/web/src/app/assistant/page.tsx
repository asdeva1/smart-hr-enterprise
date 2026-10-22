'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/require-session';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { errorMessage } from '@/lib/admin';
import { aiKeys, TOOL_LABEL, type AiStatus, type ChatTurn } from '@/lib/ai';
import { apiFetch, type SessionView } from '@/lib/api';
import { can, hasFeature } from '@/lib/permissions';

export default function AssistantPage() {
  return (
    <RequireSession>
      {(session) => (
        <AppShell active="AI assistant" session={session}>
          {hasFeature(session, 'ai.assistant') ? (
            <Assistant session={session} />
          ) : (
            <Alert tone="info">Your organisation’s plan doesn’t include the AI assistant.</Alert>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}

function Assistant({ session }: { session: SessionView }) {
  const client = useQueryClient();
  const status = useQuery({ queryKey: aiKeys.status, queryFn: () => apiFetch<AiStatus>('/v1/ai/status') });
  const [turns, setTurns] = useState<(ChatTurn & { used?: string[] })[]>([]);
  const [message, setMessage] = useState('');
  const policy = useMutation({
    mutationFn: (enabled: boolean) => apiFetch('/v1/ai/policy', { method: 'PUT', body: { enabled } }),
    onSuccess: () => client.invalidateQueries({ queryKey: aiKeys.status }),
  });
  const send = useMutation({
    mutationFn: (text: string) =>
      apiFetch<{ reply: string; toolsUsed: string[] }>('/v1/ai/assistant', {
        method: 'POST',
        body: { message: text, history: turns.slice(-10).map(({ role, content }) => ({ role, content })) },
      }),
    onSuccess: (res, text) => {
      setTurns((all) => [
        ...all,
        { role: 'user', content: text },
        { role: 'assistant', content: res.reply, used: res.toolsUsed },
      ]);
      setMessage('');
      void client.invalidateQueries({ queryKey: aiKeys.status });
    },
  });
  if (status.isPending) return <Loading />;
  if (status.isError) return <Alert tone="error">{errorMessage(status.error)}</Alert>;
  const s = status.data;
  const admin = can(session, 'settings.manage');
  return (
    <>
      <PageHeader
        title="Assistant"
        description="Ask about your own leave, time and work. It can look things up for you but can’t change anything."
      />
      {!s.available && (
        <Alert tone="info">
          AI isn’t set up on this server yet. An administrator needs to add the connection.
        </Alert>
      )}
      {s.available && (
        <section className="flex flex-wrap items-center gap-4 rounded-lg border p-4 text-sm">
          <div>
            This month: {s.tokensUsed.toLocaleString()}
            {s.tokenLimit === null
              ? ' tokens used (no limit)'
              : ` of ${s.tokenLimit.toLocaleString()} tokens used`}
          </div>
          {admin && (
            <Button variant="outline" disabled={policy.isPending} onClick={() => policy.mutate(!s.enabled)}>
              {s.enabled ? 'Turn AI off for everyone' : 'Turn AI on for the organisation'}
            </Button>
          )}
        </section>
      )}
      {s.available && !s.enabled && (
        <Alert tone="info">
          AI is switched off for your organisation.
          {admin ? ' You can turn it on above or in AI controls.' : ' An administrator can turn it on.'}
        </Alert>
      )}
      {policy.isError && <Alert tone="error">{errorMessage(policy.error)}</Alert>}
      {s.available && s.enabled && (
        <>
          <ol className="flex flex-col gap-3">
            {turns.map((t, i) => (
              <li
                key={i}
                className={`max-w-prose whitespace-pre-wrap rounded-lg border p-3 text-sm ${
                  t.role === 'user' ? 'self-end bg-muted' : ''
                }`}
              >
                {t.content}
                {t.used && t.used.length > 0 && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Looked at {t.used.map((u) => TOOL_LABEL[u] ?? u).join(', ')}
                  </div>
                )}
              </li>
            ))}
          </ol>
          {send.isError && <Alert tone="error">{errorMessage(send.error)}</Alert>}
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (message.trim()) send.mutate(message.trim());
            }}
          >
            <div className="min-w-64 flex-1">
              <Field
                id="ask"
                label="Ask a question"
                hint="For example: how many days of leave do I have left?"
              >
                <Input
                  id="ask"
                  value={message}
                  maxLength={2000}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </Field>
            </div>
            <Button type="submit" disabled={send.isPending || !message.trim()}>
              {send.isPending ? 'Thinking…' : 'Ask'}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Conversations aren’t saved. Only counts of tokens used are recorded. Check anything important in
            the app itself.
          </p>
        </>
      )}
    </>
  );
}
