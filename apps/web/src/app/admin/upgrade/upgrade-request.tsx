'use client';

import { minEmployeesFor } from '@smart-hr/validation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';

interface PublicPlan {
  code: string;
  name: string;
  description: string | null;
  prices: { currency: string; billingPeriod: string; pricingModel: string; amount: string }[];
}

const rupees = (amount: string) => `₹${Number(amount).toLocaleString('en-IN')}`;

/** Pick a plan and tell us how many employees. The request goes to the sales team, who set the plan up. */
export function UpgradeRequest({
  organisation,
  name,
  email,
  currentPlan,
}: {
  organisation: string;
  name: string;
  email: string;
  currentPlan: string | null;
}) {
  const plans = useQuery({
    queryKey: ['public', 'plans'],
    queryFn: () => apiFetch<{ plans: PublicPlan[] }>('/v1/public/plans'),
  });
  const [planCode, setPlanCode] = useState('');
  const [employees, setEmployees] = useState('');
  const [note, setNote] = useState('');
  const send = useMutation({
    mutationFn: () => {
      const plan = plans.data?.plans.find((p) => p.code === planCode);
      return apiFetch('/v1/public/contact', {
        method: 'POST',
        body: {
          name,
          email,
          company: organisation,
          interest: 'PRICING',
          ...(employees ? { employees: Number(employees) } : {}),
          message: `Upgrade request from ${organisation} (currently ${currentPlan ?? 'no plan'}). Wants: ${plan?.name ?? 'to discuss options'}.${note ? ` ${note}` : ''}`,
        },
      });
    },
  });

  const options = (plans.data?.plans ?? []).filter((p) => p.code !== 'DEMO');
  const chosen = options.find((p) => p.code === planCode);
  const min = chosen ? minEmployeesFor(chosen.code) : 1;
  const count = Number(employees);
  const tooFew = employees !== '' && chosen !== undefined && count < min;

  return (
    <>
      <PageHeader
        title="Upgrade your plan"
        description="Tell us what you need and our team will set up your plan, usually within one working day. Your data stays as it is."
      />
      {send.isSuccess ? (
        <Alert tone="success">Thanks, your request is with our team. We’ll reply to {email} shortly.</Alert>
      ) : (
        <form
          className="flex max-w-xl flex-col gap-4 rounded-lg border border-border bg-card p-5"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!tooFew) send.mutate();
          }}
        >
          {send.isError && <Alert tone="error">{errorMessage(send.error)}</Alert>}
          {plans.isPending && <Loading />}
          <Field id="up-plan" label="Plan">
            <select
              id="up-plan"
              className="h-10 rounded-md border border-border bg-card px-3"
              value={planCode}
              onChange={(ev) => setPlanCode(ev.target.value)}
            >
              <option value="">Not sure yet, let’s talk</option>
              {options.map((p) => {
                const price = p.prices.find((x) => x.currency === 'INR' && x.billingPeriod === 'MONTHLY');
                return (
                  <option key={p.code} value={p.code}>
                    {p.name}
                    {price ? ` — ${rupees(price.amount)} per employee per month` : ''}
                  </option>
                );
              })}
            </select>
          </Field>
          <Field
            id="up-employees"
            label="Number of employees"
            error={tooFew ? `${chosen?.name} starts at ${min} employees` : undefined}
            hint={chosen && !tooFew ? `${chosen.name} starts at ${min} employees.` : undefined}
          >
            <Input
              id="up-employees"
              type="number"
              min={1}
              value={employees}
              onChange={(ev) => setEmployees(ev.target.value)}
            />
          </Field>
          <Field id="up-note" label="Anything else we should know? (optional)">
            <Input id="up-note" maxLength={500} value={note} onChange={(ev) => setNote(ev.target.value)} />
          </Field>
          <div>
            <Button type="submit" disabled={send.isPending || tooFew}>
              {send.isPending ? 'Sending…' : 'Send request'}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
