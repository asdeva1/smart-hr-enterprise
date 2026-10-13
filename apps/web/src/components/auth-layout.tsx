import type { ReactNode } from 'react';

/** Split layout used by every signed-out screen: brand panel on the left, the form on the right. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-wrap">
      <section className="flex flex-[1_1_420px] flex-col justify-between gap-12 bg-sidebar px-8 py-12 text-sidebar-foreground sm:px-14">
        <div className="flex items-center gap-3 text-[17px] font-bold text-white">
          <span className="grid size-9 place-items-center rounded-[9px] bg-primary font-mono text-sm">
            SH
          </span>
          Smart HR Enterprise
        </div>
        <div className="flex max-w-[480px] flex-col gap-5">
          <p className="text-[40px] leading-[1.12] font-semibold tracking-tight text-white">
            People, payroll, finance and operations in one place.
          </p>
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
      <main className="flex flex-[1_1_420px] items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
    </div>
  );
}
