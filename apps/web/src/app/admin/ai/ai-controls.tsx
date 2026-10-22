'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { aiKeys, FEATURE_LABEL, type AiStatus, type AiUsageRow } from '@/lib/ai';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';

const n = (v: number) => v.toLocaleString('en-IN');

/** Switch AI on or off for the organisation and see how much of the allowance has been used. */
export function AiControls({ governance }: { governance: boolean }) {
  const client = useQueryClient();
  const status = useQuery({ queryKey: aiKeys.status, queryFn: () => apiFetch<AiStatus>('/v1/ai/status') });
  const usage = useQuery({
    queryKey: aiKeys.usage,
    queryFn: () => apiFetch<AiUsageRow[]>('/v1/ai/usage'),
    enabled: governance,
  });
  const policy = useMutation({
    mutationFn: (enabled: boolean) => apiFetch('/v1/ai/policy', { method: 'PUT', body: { enabled } }),
    onSuccess: () => client.invalidateQueries({ queryKey: aiKeys.status }),
  });

  if (status.isPending) return <Loading />;
  if (status.isError) return <Alert tone="error">{errorMessage(status.error)}</Alert>;
  const s = status.data;
  const pct = s.tokenLimit ? Math.min(100, Math.round((s.tokensUsed / s.tokenLimit) * 100)) : null;
  const exhausted = s.tokensAvailable !== null && s.tokensAvailable <= 0;
  const low =
    !exhausted &&
    s.tokensAvailable !== null &&
    s.tokenLimit !== null &&
    s.tokensAvailable < s.tokenLimit * 0.2;

  return (
    <>
      <PageHeader
        title="AI controls"
        description="Choose whether people in your organisation can use the AI assistant, and keep an eye on the allowance."
      />

      {!s.available && (
        <Alert tone="info">
          AI isn’t connected on this server yet, so it can’t be used even when switched on. Contact your Smart
          HR account manager.
        </Alert>
      )}
      {exhausted && (
        <Alert tone="error">
          Your AI allowance is used up. The assistant stops answering until next month’s allowance starts.
        </Alert>
      )}
      {low && (
        <Alert tone="warning">
          Less than a fifth of your AI allowance is left. Ask your account manager if you need more.
        </Alert>
      )}
      {policy.isError && <Alert tone="error">{errorMessage(policy.error)}</Alert>}

      <section aria-labelledby="ai-switch" className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="ai-switch" className="text-lg font-semibold">
              AI assistant
            </h2>
            <span className="text-[13px] text-muted-foreground">
              Answers only from what the person asking is allowed to see, and can’t change anything. Questions
              and answers are not stored, only how much was used.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Badge tone={s.enabled ? 'success' : 'neutral'}>{s.enabled ? 'On' : 'Off'}</Badge>
            <Button
              variant={s.enabled ? 'outline' : 'primary'}
              disabled={policy.isPending}
              onClick={() => policy.mutate(!s.enabled)}
            >
              {s.enabled ? 'Turn off for everyone' : 'Turn on for everyone'}
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="ai-allowance" className="flex flex-col gap-3">
        <h2 id="ai-allowance" className="text-[15px] font-semibold">
          Allowance
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
            <span className="text-[13px] text-muted-foreground">Used this month</span>
            <span className="text-lg font-semibold tabular-nums">
              {n(s.tokensUsed)}
              {s.tokenLimit !== null ? ` of ${n(s.tokenLimit)}` : ' tokens'}
            </span>
            {pct !== null && (
              <div
                className="h-1.5 rounded-full bg-muted"
                role="meter"
                aria-label="AI allowance used this month"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
              >
                <div
                  className={cn('h-1.5 rounded-full', pct >= 80 ? 'bg-danger' : 'bg-primary')}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
            {s.tokenLimit === null && <span className="text-xs text-muted-foreground">No monthly limit</span>}
          </div>
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
            <span className="text-[13px] text-muted-foreground">Available now</span>
            <span className="text-lg font-semibold tabular-nums">
              {s.tokensAvailable === null ? 'No limit' : n(s.tokensAvailable)}
            </span>
            {s.tokensAvailable !== null && (
              <span className="text-xs text-muted-foreground">
                {s.rolloverMonths > 0
                  ? `Includes unused tokens carried over from the last ${s.rolloverMonths} month${s.rolloverMonths > 1 ? 's' : ''}`
                  : 'Unused tokens carry over for up to 3 months'}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
            <span className="text-[13px] text-muted-foreground">Model</span>
            <span className="text-lg font-semibold">{s.model}</span>
          </div>
        </div>
      </section>

      {governance && (
        <section aria-labelledby="ai-usage" className="flex flex-col gap-3">
          <h2 id="ai-usage" className="text-[15px] font-semibold">
            Use this month
          </h2>
          {usage.isPending && <Loading />}
          {usage.isError && <Alert tone="error">{errorMessage(usage.error)}</Alert>}
          {usage.data && usage.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Nobody has used the assistant this month.</p>
          )}
          {usage.data && usage.data.length > 0 && (
            <Table label="AI use this month">
              <thead>
                <tr>
                  <Th>Feature</Th>
                  <Th>Person</Th>
                  <Th className="text-right">Questions</Th>
                  <Th className="text-right">Tokens</Th>
                </tr>
              </thead>
              <tbody>
                {[...usage.data]
                  .sort((a, b) => b.tokens - a.tokens)
                  .map((r) => (
                    <tr key={`${r.feature}:${r.userId}`}>
                      <Td>{FEATURE_LABEL[r.feature] ?? r.feature}</Td>
                      <Td className="font-mono text-xs">{r.userId.slice(0, 8)}</Td>
                      <Td className="text-right tabular-nums">{n(r.calls)}</Td>
                      <Td className="text-right tabular-nums">{n(r.tokens)}</Td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          )}
        </section>
      )}
    </>
  );
}
