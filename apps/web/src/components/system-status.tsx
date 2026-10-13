'use client';

import { useQuery } from '@tanstack/react-query';
import { apiBaseUrl, fetchReadiness } from '@/lib/api';
import { cn } from '@/lib/utils';

function Pill({ ok, children }: { ok: boolean; children: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
      )}
    >
      {children}
    </span>
  );
}

/** Live readiness of the API and its dependencies. Shows only what the API reports; nothing is invented. */
export function SystemStatus() {
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: () => fetchReadiness(),
  });

  return (
    <section aria-labelledby="system-status" className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="system-status" className="text-[15px] font-semibold">
          System status
        </h2>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="text-[13px] font-medium text-primary hover:underline disabled:opacity-50"
        >
          {isFetching ? 'Checking…' : 'Check again'}
        </button>
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">
        API at <span className="font-mono">{apiBaseUrl()}</span>
      </p>

      <dl className="mt-3 divide-y divide-muted">
        <div className="flex items-center justify-between py-3">
          <dt>API</dt>
          <dd>
            {isPending ? (
              <span className="text-muted-foreground">Checking…</span>
            ) : (
              <Pill ok={!isError}>{isError ? 'Unreachable' : 'Reachable'}</Pill>
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between py-3">
          <dt>Database</dt>
          <dd>{data ? <Pill ok={data.checks.database === 'up'}>{data.checks.database}</Pill> : '—'}</dd>
        </div>
        <div className="flex items-center justify-between py-3">
          <dt>Redis</dt>
          <dd>{data ? <Pill ok={data.checks.redis === 'up'}>{data.checks.redis}</Pill> : '—'}</dd>
        </div>
      </dl>
    </section>
  );
}
