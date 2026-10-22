import Link from 'next/link';
import { APP_URL } from '@/lib/config';

export function Footer() {
  return (
    <footer className="mt-24 bg-ink text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <p className="font-display text-2xl font-semibold">SmartHRMS</p>
          <p className="mt-3 max-w-xs text-[15px] text-white/70">
            People, payroll and operations in one place, built for Indian teams that close the month on time.
          </p>
        </div>
        <FooterColumn
          title="Product"
          items={[
            ['/features', 'Features'],
            ['/plans', 'Plans'],
            ['/security', 'Security'],
          ]}
        />
        <FooterColumn
          title="Get started"
          items={[
            ['/demo', 'Try the demo'],
            ['/plans', 'Buy a plan'],
            ['/contact', 'Talk to us'],
          ]}
        />
        <div>
          <p className="font-semibold">Already a customer</p>
          <ul className="mt-3 space-y-2 text-[15px] text-white/75">
            <li>
              <a className="hover:text-white" href={`${APP_URL}/login`}>
                Sign in
              </a>
            </li>
            <li>
              <a className="hover:text-white" href={`${APP_URL}/forgot-password`}>
                Reset password
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/15 px-5 py-5 text-center text-sm text-white/60">
        © {new Date().getFullYear()} SmartHRMS. All rights reserved.
      </div>
    </footer>
  );
}

function FooterColumn({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <div>
      <p className="font-semibold">{title}</p>
      <ul className="mt-3 space-y-2 text-[15px] text-white/75">
        {items.map(([href, label]) => (
          <li key={href + label}>
            <Link className="hover:text-white" href={href}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
