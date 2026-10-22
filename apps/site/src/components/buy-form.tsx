'use client';

import { checkoutSchema, minEmployeesFor } from '@smart-hr/validation';
import { useState } from 'react';
import { postJson } from '@/lib/api';
import { readForm } from '@/lib/form';
import { formatPrice, type PublicPlan } from '@/lib/plans';
import { Button, Field, inputClass, Notice } from './ui';

interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}
interface RazorpayCtor {
  new (options: Record<string, unknown>): { open(): void; on(event: string, cb: () => void): void };
}
declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

type Stage = 'form' | 'paying' | 'confirming' | 'paid';

export function BuyForm({ plans, initialPlan }: { plans: PublicPlan[]; initialPlan?: string | undefined }) {
  const buyable = plans.filter((p) => p.prices.some((x) => x.currency === 'INR'));
  const [planCode, setPlanCode] = useState(
    buyable.find((p) => p.code === initialPlan)?.code ?? buyable[0]?.code ?? '',
  );
  const [period, setPeriod] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('form');
  const [email, setEmail] = useState('');

  const plan = buyable.find((p) => p.code === planCode);
  const price = plan?.prices.find((x) => x.currency === 'INR' && x.billingPeriod === period);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFailure(null);
    const result = readForm(e.currentTarget, checkoutSchema);
    if (result.errors) return setErrors(result.errors);
    setErrors({});
    setStage('paying');
    const order = await postJson<{
      orderId: string;
      providerOrderId: string;
      keyId: string;
      amountMinor: number;
      currency: string;
    }>('/v1/checkout', result.data);
    if (!order.ok || !order.data) {
      setErrors(order.fieldErrors);
      setFailure(order.message);
      return setStage('form');
    }
    if (!(await loadRazorpay()) || !window.Razorpay) {
      setFailure('The payment window couldn’t load. Check your connection and try again.');
      return setStage('form');
    }
    const { data } = result;
    const o = order.data;
    const rzp = new window.Razorpay({
      key: o.keyId,
      order_id: o.providerOrderId,
      amount: o.amountMinor,
      currency: o.currency,
      name: 'SmartHRMS',
      description: `${plan?.name ?? 'Plan'} (${period === 'ANNUAL' ? 'annual' : 'monthly'})`,
      prefill: { name: data.displayName, email: data.email },
      theme: { color: '#1d56c9' },
      modal: { ondismiss: () => setStage((s) => (s === 'paying' ? 'form' : s)) },
      handler: async (r: RazorpayResponse) => {
        setStage('confirming');
        const res = await postJson('/v1/checkout/confirm', {
          orderId: o.orderId,
          paymentId: r.razorpay_payment_id,
          signature: r.razorpay_signature,
        });
        if (res.ok) {
          setEmail(data.email);
          return setStage('paid');
        }
        // The payment itself went through. The signed webhook will still create the organisation.
        setFailure(
          'Your payment was received, but we couldn’t confirm it just now. Your organisation will still be set up and we’ll email you; if nothing arrives within 15 minutes, contact us with your payment reference ' +
            r.razorpay_payment_id +
            '.',
        );
        setStage('form');
      },
    });
    rzp.open();
  }

  if (stage === 'paid') {
    return (
      <Notice tone="success">
        <p className="font-semibold">Payment received. Your organisation is being set up.</p>
        <p className="mt-1">
          We’ve emailed an invitation to {email}. Open it to set your password and sign in.
        </p>
      </Notice>
    );
  }

  if (buyable.length === 0) {
    return (
      <Notice tone="error">
        Online purchase isn’t open yet. Please{' '}
        <a className="underline" href="/contact">
          contact us
        </a>{' '}
        and we’ll set you up.
      </Notice>
    );
  }

  const busy = stage !== 'form';
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-5">
      {failure && <Notice tone="error">{failure}</Notice>}
      <input type="hidden" name="planCode" value={planCode} />
      <input type="hidden" name="billingPeriod" value={period} />
      <Field id="plan" label="Plan">
        <select
          id="plan"
          value={planCode}
          onChange={(e) => setPlanCode(e.target.value)}
          className={inputClass}
        >
          {buyable.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-[15px] font-medium">Billing</legend>
        <div className="flex gap-3">
          {(['MONTHLY', 'ANNUAL'] as const).map((p) => (
            <label
              key={p}
              className={`flex-1 cursor-pointer rounded-md border px-4 py-3 text-[15px] ${
                period === p ? 'border-brand bg-brand-soft font-semibold' : 'border-ink/25 bg-white'
              }`}
            >
              <input
                type="radio"
                className="sr-only"
                checked={period === p}
                onChange={() => setPeriod(p)}
                name="period-choice"
              />
              {p === 'MONTHLY' ? 'Monthly' : 'Annual'}
            </label>
          ))}
        </div>
      </fieldset>
      {price ? (
        <p className="text-[15px] text-muted">{formatPrice(price.amount, price.pricingModel, period)}</p>
      ) : (
        <Notice tone="error">
          This plan isn’t sold with {period.toLowerCase()} billing. Try the other option.
        </Notice>
      )}
      {price && price.pricingModel !== 'FLAT' && (
        <Field
          id="quantity"
          label={price.pricingModel === 'PER_EMPLOYEE' ? 'Number of employees' : 'Number of members'}
          error={errors.quantity}
          hint={
            price.pricingModel === 'PER_EMPLOYEE'
              ? `This plan starts at ${minEmployeesFor(planCode)} employees.`
              : undefined
          }
        >
          <input
            key={planCode}
            id="quantity"
            name="quantity"
            inputMode="numeric"
            defaultValue={String(Math.max(10, minEmployeesFor(planCode)))}
            className={inputClass}
          />
        </Field>
      )}
      <Field id="organisationName" label="Organisation name" error={errors.organisationName}>
        <input
          id="organisationName"
          name="organisationName"
          autoComplete="organization"
          className={inputClass}
        />
      </Field>
      <Field id="displayName" label="Your name" error={errors.displayName}>
        <input id="displayName" name="displayName" autoComplete="name" className={inputClass} />
      </Field>
      <Field
        id="email"
        label="Work email"
        hint="You’ll be the organisation’s owner; the invitation goes here."
        error={errors.email}
      >
        <input id="email" name="email" type="email" autoComplete="email" className={inputClass} />
      </Field>
      <Button type="submit" disabled={busy || !price} className="w-full">
        {stage === 'paying'
          ? 'Opening payment…'
          : stage === 'confirming'
            ? 'Confirming payment…'
            : 'Continue to payment'}
      </Button>
    </form>
  );
}
