'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { APP_URL } from '@/lib/config';
import { Button, Field, inputClass } from './ui';

/**
 * "Sign in" opens a small login box right under the header: on hover (mouse), on click or tap, or by keyboard.
 * The form posts straight to the application, which signs the person in and carries on into the app.
 */
export function SignInMenu() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show() {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setOpen(true);
  }
  function hideSoon() {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    // Stay open while a field has focus, so moving the mouse away while typing never closes the box.
    leaveTimer.current = setTimeout(() => {
      if (!root.current?.contains(document.activeElement)) setOpen(false);
    }, 250);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <div
      ref={root}
      className="relative"
      onMouseEnter={(e) => {
        // Touch screens fire a synthetic mouseenter on tap; the click handler handles those.
        if (window.matchMedia('(hover: hover)').matches && e.type === 'mouseenter') show();
      }}
      onMouseLeave={hideSoon}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="signin-panel"
        onClick={() => (open ? setOpen(false) : show())}
        className="rounded-md px-3 py-2 text-[15px] font-semibold text-ink hover:bg-brand-soft"
      >
        Sign in
      </button>
      {open && (
        <div
          id="signin-panel"
          role="dialog"
          aria-label="Sign in to SmartHRMS"
          className="signin-pop absolute right-0 top-full z-40 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-md border border-line bg-white p-5 shadow-xl shadow-ink/15"
        >
          <form
            method="post"
            action={`${APP_URL}/login/handoff`}
            onSubmit={() => setBusy(true)}
            className="space-y-4"
          >
            <Field id="signin-email" label="Work email">
              <input
                id="signin-email"
                name="email"
                type="email"
                required
                autoComplete="username"
                autoFocus
                className={inputClass}
              />
            </Field>
            <Field id="signin-password" label="Password">
              <input
                id="signin-password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className={inputClass}
              />
            </Field>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
            <div className="flex justify-between text-[14px]">
              <a className="font-semibold text-brand hover:underline" href={`${APP_URL}/forgot-password`}>
                Forgot password?
              </a>
              <Link className="font-semibold text-brand hover:underline" href="/demo">
                Try the demo
              </Link>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
