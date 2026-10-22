import type { Metadata } from 'next';
import { BuyForm } from '@/components/buy-form';
import { loadPlans } from '@/lib/plans';

export const metadata: Metadata = { title: 'Buy a plan' };

export default async function Buy({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const [{ plan }, plans] = await Promise.all([searchParams, loadPlans()]);
  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-5 pt-16 lg:grid-cols-[1fr_480px]">
      <div>
        <h1 className="text-5xl font-semibold">Buy a plan.</h1>
        <p className="mt-5 max-w-xl text-lg text-muted">
          Pay securely with UPI, card or net banking. When the payment clears, your organisation is created
          and an invitation lands in your inbox. No waiting for a salesperson.
        </p>
      </div>
      <div className="h-fit rounded-md border border-line bg-white p-6 sm:p-8">
        <BuyForm plans={plans ?? []} initialPlan={plan} />
      </div>
    </div>
  );
}
