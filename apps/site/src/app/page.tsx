import Link from 'next/link';
import { MonthEnd } from '@/components/month-end';
import { ButtonLink } from '@/components/ui';
import { areas } from '@/lib/content';

export default function Home() {
  return (
    <>
      <section className="bg-ink text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 md:py-24 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <h1 className="text-[2.6rem] font-semibold sm:text-6xl">
              Close the month without chasing anyone.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-white/80">
              SmartHRMS keeps employee records, attendance, leave and payroll in one system, so the numbers
              Finance approves are the numbers HR already confirmed. Built for India, with PF, ESI, PT and TDS
              included.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/demo" look="inverse">
                Try the demo with your work email
              </ButtonLink>
              <ButtonLink
                href="/plans"
                look="secondary"
                className="!border-white/40 !bg-transparent !text-white hover:!bg-white/10"
              >
                See plans
              </ButtonLink>
            </div>
            <p className="mt-4 text-sm text-white/60">
              The demo is limited to 5 members and 25 employees, free for 14 days.
            </p>
          </div>
          <MonthEnd />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pt-20">
        <h2 className="max-w-2xl text-4xl font-semibold">One system for the whole employee story.</h2>
        <p className="mt-4 max-w-2xl text-muted">
          Start with people and time. Add payroll, operations and finance when you need them; your data is
          already there.
        </p>
        <div className="mt-10 divide-y divide-line border-y border-line">
          {areas.map((a) => (
            <div key={a.name} className="grid gap-4 py-8 md:grid-cols-[220px_1fr] md:gap-10">
              <h3 className="text-2xl font-semibold">{a.name}</h3>
              <div>
                <p className="text-lg">{a.lead}</p>
                <ul className="mt-3 grid gap-x-8 gap-y-1.5 text-[16px] text-muted sm:grid-cols-2">
                  {a.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6">
          <Link href="/features" className="font-semibold text-brand hover:underline">
            Everything in detail
          </Link>
        </p>
      </section>

      <section className="mx-auto mt-24 max-w-6xl px-5">
        <div className="grid gap-8 rounded-md bg-brand-soft p-8 md:grid-cols-[1fr_auto] md:items-center md:p-12">
          <div>
            <h2 className="text-3xl font-semibold">See it with your own people data.</h2>
            <p className="mt-3 max-w-xl text-ink-soft">
              Sign up with your company email and you get a private workspace in minutes. Ready to go live?
              Choose a plan and your organisation is set up as soon as the payment clears.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/demo">Start the demo</ButtonLink>
            <ButtonLink href="/contact" look="secondary">
              Talk to us
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
