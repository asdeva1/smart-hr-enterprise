import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Sign in' };

const inputClasses =
  'h-11 w-full rounded-md border border-input bg-card px-3 text-foreground disabled:cursor-not-allowed disabled:bg-muted';

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-wrap">
      <section className="flex flex-[1_1_420px] flex-col justify-between gap-12 bg-sidebar px-14 py-12 text-sidebar-foreground">
        <div className="flex items-center gap-3 text-[17px] font-bold text-white">
          <span className="grid size-9 place-items-center rounded-[9px] bg-primary font-mono text-sm">
            SH
          </span>
          Smart HR Enterprise
        </div>
        <div className="flex max-w-[480px] flex-col gap-5">
          <h1 className="text-[40px] leading-[1.12] font-semibold tracking-tight text-white">
            People, payroll, finance and operations in one place.
          </h1>
          <p className="text-base text-[#a9b8c4]">
            One platform for HR, finance and configurable operations — run as SaaS, a dedicated environment,
            or inside your own data centre.
          </p>
        </div>
        <div className="flex flex-wrap gap-6 text-[13px] text-sidebar-muted">
          <span>Tenant data isolated by design</span>
          <span>Every change audited</span>
          <span>AI is optional and permission-aware</span>
        </div>
      </section>

      <section className="flex flex-[1_1_420px] items-center justify-center px-6 py-12">
        <form className="flex w-full max-w-[400px] flex-col gap-5" aria-describedby="signin-status">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-[26px] font-semibold tracking-tight">Sign in</h2>
            <p className="text-muted-foreground">Use your work account for this organisation.</p>
          </div>
          <p
            id="signin-status"
            role="status"
            className="rounded-md border border-warning/30 bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning"
          >
            Sign-in is switched on in Phase 2, together with sessions, lockout and password reset.
          </p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-[13px] font-medium">
              Work email
            </label>
            <input id="email" type="email" autoComplete="username" disabled className={inputClasses} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-[13px] font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              disabled
              className={inputClasses}
            />
          </div>
          <Button type="submit" size="lg" disabled>
            Sign in
          </Button>
          <Link href="/" className="text-center text-[13px] text-primary hover:underline">
            Back to dashboard
          </Link>
        </form>
      </section>
    </div>
  );
}
