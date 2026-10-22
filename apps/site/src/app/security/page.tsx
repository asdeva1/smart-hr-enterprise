import type { Metadata } from 'next';
import { ButtonLink } from '@/components/ui';
import { security } from '@/lib/content';

export const metadata: Metadata = { title: 'Security' };

export default function Security() {
  return (
    <div className="mx-auto max-w-6xl px-5 pt-16">
      <h1 className="max-w-3xl text-5xl font-semibold">Your people data deserves more than a login page.</h1>
      <p className="mt-5 max-w-2xl text-lg text-muted">
        Salaries, bank accounts and identity numbers are some of the most sensitive data a company holds. This
        is how SmartHRMS protects them.
      </p>
      <dl className="mt-12 divide-y divide-line border-y border-line">
        {security.map(([title, text]) => (
          <div key={title} className="grid gap-2 py-7 md:grid-cols-[300px_1fr] md:gap-10">
            <dt className="font-display text-xl font-semibold">{title}</dt>
            <dd className="max-w-2xl text-muted">{text}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-12">
        <ButtonLink href="/contact">Ask us a security question</ButtonLink>
      </div>
    </div>
  );
}
