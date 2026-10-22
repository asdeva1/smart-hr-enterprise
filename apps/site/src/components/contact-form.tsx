'use client';

import { contactSalesSchema } from '@smart-hr/validation';
import { useState } from 'react';
import { postJson } from '@/lib/api';
import { readForm } from '@/lib/form';
import { Button, Field, inputClass, Notice } from './ui';

export function ContactForm({ defaultInterest = 'PRICING' }: { defaultInterest?: string | undefined }) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFailure(null);
    const result = readForm(e.currentTarget, contactSalesSchema);
    if (result.errors) return setErrors(result.errors);
    setErrors({});
    setBusy(true);
    const res = await postJson('/v1/public/contact', result.data);
    setBusy(false);
    if (res.ok) return setDone(true);
    setErrors(res.fieldErrors);
    setFailure(res.message);
  }

  if (done) {
    return (
      <Notice tone="success">
        <p className="font-semibold">Thanks, we’ve got your message.</p>
        <p className="mt-1">Someone from our team will reply within one working day.</p>
      </Notice>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-5">
      {failure && <Notice tone="error">{failure}</Notice>}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="name" label="Your name" error={errors.name}>
          <input id="name" name="name" autoComplete="name" className={inputClass} />
        </Field>
        <Field id="email" label="Work email" error={errors.email}>
          <input id="email" name="email" type="email" autoComplete="email" className={inputClass} />
        </Field>
        <Field id="company" label="Company" error={errors.company}>
          <input id="company" name="company" autoComplete="organization" className={inputClass} />
        </Field>
        <Field id="phone" label="Phone (optional)" error={errors.phone}>
          <input id="phone" name="phone" type="tel" autoComplete="tel" className={inputClass} />
        </Field>
        <Field id="employees" label="Number of employees (optional)" error={errors.employees}>
          <input id="employees" name="employees" inputMode="numeric" className={inputClass} />
        </Field>
        <Field id="interest" label="I’m interested in">
          <select id="interest" name="interest" defaultValue={defaultInterest} className={inputClass}>
            <option value="PRICING">Pricing and plans</option>
            <option value="DEMO">A guided demo</option>
            <option value="DEDICATED">A dedicated or private setup</option>
            <option value="OTHER">Something else</option>
          </select>
        </Field>
      </div>
      <Field id="message" label="Anything we should know? (optional)" error={errors.message}>
        <textarea id="message" name="message" rows={4} className={inputClass} />
      </Field>
      <Button type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Send message'}
      </Button>
    </form>
  );
}
