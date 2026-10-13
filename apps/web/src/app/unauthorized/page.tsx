import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthLayout } from '@/components/auth-layout';

export const metadata: Metadata = { title: 'No access' };

export default function UnauthorizedPage() {
  return (
    <AuthLayout>
      <div className="flex flex-col gap-5">
        <h1 className="text-[26px] font-semibold tracking-tight">You don’t have access to this</h1>
        <p className="text-muted-foreground">
          Your account isn’t allowed to open that page in this organisation. If you think you should have
          access, ask your organisation’s administrator.
        </p>
        <div className="flex flex-wrap gap-4 text-[13px]">
          <Link href="/" className="text-primary hover:underline">
            Go to dashboard
          </Link>
          <Link href="/select-organisation" className="text-primary hover:underline">
            Switch organisation
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}
