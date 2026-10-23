'use client';

import { AREAS, DELIVERY_LABEL, FEATURES, LIMITS, MODULE_SPECS, type Delivery } from '@smart-hr/entitlements';
import { PlatformPage } from '@/components/platform/platform-page';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { formatLimit, usePlans, type PlanVersion } from '@/lib/plan';

const TONE: Record<Delivery, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  BUILT: 'success',
  BUILT_UNGATED: 'info',
  PARTIAL: 'warning',
  NOT_BUILT: 'danger',
  DEFERRED: 'neutral',
};

function Features() {
  const plans = usePlans();
  const columns = (plans.data ?? [])
    .filter((p) => p.status === 'ACTIVE')
    .map((p) => ({
      plan: p,
      version:
        p.versions.find((v) => v.status === 'PUBLISHED') ?? p.versions.find((v) => v.status === 'DRAFT'),
    }))
    .filter((c): c is { plan: (typeof c)['plan']; version: PlanVersion } => c.version !== undefined);
  const featureCount = Object.keys(FEATURES).length;

  return (
    <>
      <PageHeader
        title="Features and specifications"
        description={`${MODULE_SPECS.length} modules covering ${featureCount} plan features. Use this list to decide which plan includes what.`}
      />
      <div className="flex flex-wrap gap-2" aria-label="Meaning of the tags">
        {(Object.keys(DELIVERY_LABEL) as Delivery[]).map((d) => (
          <Badge key={d} tone={TONE[d]}>
            {DELIVERY_LABEL[d]}
          </Badge>
        ))}
      </div>

      {AREAS.map((area) => {
        const specs = MODULE_SPECS.filter((m) => m.area === area);
        if (specs.length === 0) return null;
        return (
          <section key={area} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{area}</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {specs.map((m) => (
                <article
                  key={m.id}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[15px] font-semibold">{m.name}</h3>
                    <Badge tone={TONE[m.delivery]}>
                      {m.delivery === 'BUILT' && m.features.length === 0
                        ? 'Built, in every plan'
                        : DELIVERY_LABEL[m.delivery]}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">{m.summary}</p>
                  <ul className="ml-4 list-disc space-y-0.5 text-sm">
                    {m.capabilities.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                  {m.notYet && m.notYet.length > 0 && (
                    <p className="text-sm text-warning">Not yet: {m.notYet.join('; ')}</p>
                  )}
                  <p className="mt-auto text-xs text-muted-foreground">
                    {m.features.length === 0
                      ? 'In every plan'
                      : `Plan feature: ${m.features.map((f) => FEATURES[f].label).join(', ')}`}
                    {m.limits && m.limits.length > 0
                      ? ` · Limits: ${m.limits.map((l) => LIMITS[l].label).join(', ')}`
                      : ''}
                  </p>
                </article>
              ))}
            </div>
          </section>
        );
      })}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">What each plan includes today</h2>
        {columns.length === 0 ? (
          <p className="text-muted-foreground">No plans yet. Create them in the plan catalogue.</p>
        ) : (
          <Table label="Plan features">
            <thead>
              <tr>
                <Th>Feature</Th>
                {columns.map((c) => (
                  <Th key={c.plan.id}>{c.plan.name}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(FEATURES).map(([code, f]) => (
                <tr key={code}>
                  <Td>
                    {f.label} <span className="text-xs text-muted-foreground">{f.module}</span>
                  </Td>
                  {columns.map((c) => (
                    <Td key={c.plan.id}>
                      {c.version.features.includes(code) ? (
                        <span aria-label="Included">✓</span>
                      ) : (
                        <span className="text-muted-foreground" aria-label="Not included">
                          —
                        </span>
                      )}
                    </Td>
                  ))}
                </tr>
              ))}
              {Object.entries(LIMITS).map(([code, l]) => (
                <tr key={code}>
                  <Td>{l.label}</Td>
                  {columns.map((c) => (
                    <Td key={c.plan.id}>{formatLimit(c.version.limits[code] ?? null, l.unit)}</Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </>
  );
}

export default function PlatformFeaturesPage() {
  return <PlatformPage active="Features and specifications">{() => <Features />}</PlatformPage>;
}
