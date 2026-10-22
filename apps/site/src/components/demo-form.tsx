'use client';

import { isFreeEmailDomain, signupSchema, WORK_EMAIL_MESSAGE } from '@smart-hr/validation';
import { useState } from 'react';
import { postJson } from '@/lib/api';
import { readForm } from '@/lib/form';
import { Button, Field, inputClass, Notice } from './ui';

export function DemoForm() {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFailure(null);
    const result = readForm(e.currentTarget, signupSchema);
    if (result.errors) return setErrors(result.errors);
    if (isFreeEmailDomain(result.data.email.split('@')[1] ?? '')) {
      return setErrors({ email: WORK_EMAIL_MESSAGE });
    }
    setErrors({});
    setBusy(true);
    const res = await postJson('/v1/signup', result.data);
    setBusy(false);
    if (res.ok) return setSentTo(result.data.email);
    setErrors(res.fieldErrors);
    setFailure(res.message);
  }

  if (sentTo) {
    return (
      <Notice tone="success">
        <p className="font-semibold">Check your email.</p>
        <p className="mt-1">
          If {sentTo} can start a demo, we’ve sent a link to set your password and open your workspace. It
          expires in a few hours.
        </p>
      </Notice>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-5">
      {failure && <Notice tone="error">{failure}</Notice>}
      <Field id="organisationName" label="Company name" error={errors.organisationName}>
        <input
          id="organisationName"
          name="organisationName"
          autoComplete="organization"
          className={inputClass}
          aria-describedby={errors.organisationName ? 'organisationName-error' : undefined}
        />
      </Field>
      <Field id="displayName" label="Your name" error={errors.displayName}>
        <input id="displayName" name="displayName" autoComplete="name" className={inputClass} />
      </Field>
      <Field
        id="email"
        label="Work email"
        hint="Personal addresses such as Gmail can’t start a demo."
        error={errors.email}
      >
        <input id="email" name="email" type="email" autoComplete="email" className={inputClass} />
      </Field>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Sending…' : 'Send my demo link'}
      </Button>
    </form>
  );
}
