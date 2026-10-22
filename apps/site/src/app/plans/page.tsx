import type { Metadata } from 'next';
import { ButtonLink } from '@/components/ui';
import { formatPrice, loadPlans, priceFor, type PublicPlan } from '@/lib/plans';

export const metadata: Metadata = { title: 'Plans' };
export const revalidate = 300;

export default async function Plans() {
  const plans = await loadPlans();
  const list = plans ?? [];

  return (
    <div className="mx-auto max-w-6xl px-5 pt-16">
      <h1 className="max-w-3xl text-5xl font-semibold">Pick the plan that fits your team.</h1>
      <p className="mt-5 max-w-2xl text-lg text-muted">
        Prices are in Indian rupees. Pay online and your organisation is created automatically; we email the
        owner an invitation to set a password.
      </p>

      {list.length === 0 ? (
        <div className="mt-12 rounded-md border border-line bg-white p-8">
          <h2 className="text-2xl font-semibold">Plans are being finalised.</h2>
          <p className="mt-2 max-w-xl text-muted">
            Tell us about your team and we’ll send you the right plan and a quote, or start with the demo.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href="/contact">Talk to us</ButtonLink>
            <ButtonLink href="/demo" look="secondary">
              Try the demo
            </ButtonLink>
          </div>
        </div>
      ) : (
        <div className="mt-12 grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
          {list.map((p) => (
            <PlanColumn key={p.code} plan={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanColumn({ plan }: { plan: PublicPlan }) {
  const monthly = priceFor(plan, 'MONTHLY');
  const annual = priceFor(plan, 'ANNUAL');
  const buyable = Boolean(monthly ?? annual);
  return (
    <section className="flex flex-col rounded-md border border-line bg-white p-6">
      <h2 className="text-2xl font-semibold">{plan.name}</h2>
      {plan.description && <p className="mt-2 text-[15px] text-muted">{plan.description}</p>}
      <div className="mt-5 min-h-16">
        {monthly || annual ? (
          <>
            {monthly && (
              <p className="font-display text-lg font-semibold">
                {formatPrice(monthly.amount, monthly.pricingModel, 'MONTHLY')}
              </p>
            )}
            {annual && (
              <p className="text-[15px] text-muted">
                or {formatPrice(annual.amount, annual.pricingModel, 'ANNUAL')}
              </p>
            )}
          </>
        ) : (
          <p className="font-display text-lg font-semibold">Contact us for pricing</p>
        )}
      </div>
      <ul className="mt-4 space-y-1.5 border-t border-line pt-4 text-[15px]">
        {plan.limits
          .filter((l) => l.value !== null && l.value > 0)
          .map((l) => (
            <li key={l.label}>
              Up to {l.value} {l.unit}
            </li>
          ))}
      </ul>
      <details className="mt-4 text-[15px]">
        <summary className="cursor-pointer font-semibold text-brand">What’s included</summary>
        <div className="mt-3 space-y-3">
          {plan.modules.map((m) => (
            <div key={m.module}>
              <p className="font-semibold">{m.module}</p>
              <ul className="text-muted">
                {m.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
      <div className="mt-auto pt-6">
        {buyable ? (
          <ButtonLink href={`/buy?plan=${encodeURIComponent(plan.code)}`} className="w-full">
            Buy {plan.name}
          </ButtonLink>
        ) : (
          <ButtonLink href="/contact" look="secondary" className="w-full">
            Contact us
          </ButtonLink>
        )}
      </div>
    </section>
  );
}
