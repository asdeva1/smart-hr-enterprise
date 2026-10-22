import type { Metadata } from 'next';
import { ButtonLink } from '@/components/ui';
import { areas } from '@/lib/content';

export const metadata: Metadata = { title: 'Features' };

export default function Features() {
  return (
    <div className="mx-auto max-w-6xl px-5 pt-16">
      <h1 className="max-w-3xl text-5xl font-semibold">Everything your people team touches in a month.</h1>
      <p className="mt-5 max-w-2xl text-lg text-muted">
        Which modules you get depends on your plan. The demo includes employee records, attendance, leave and
        standard reports.
      </p>
      <div className="mt-12 space-y-14">
        {areas.map((a) => (
          <section
            key={a.name}
            id={a.name.toLowerCase()}
            className="grid gap-6 md:grid-cols-[220px_1fr] md:gap-10"
          >
            <h2 className="text-3xl font-semibold">{a.name}</h2>
            <div>
              <p className="text-xl">{a.lead}</p>
              <ul className="mt-5 space-y-3 border-l-2 border-brand pl-5 text-[17px]">
                {a.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>
      <div className="mt-16 flex flex-wrap gap-3">
        <ButtonLink href="/demo">Try the demo</ButtonLink>
        <ButtonLink href="/plans" look="secondary">
          Compare plans
        </ButtonLink>
      </div>
    </div>
  );
}
