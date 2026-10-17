'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api';
import type { Correction } from '@/lib/attendance';

/**
 * Asks for a day's times to be corrected. Times are the employee's local times; a clock-out earlier than
 * the clock-in is read as the next morning (night shifts).
 */
export function CorrectionDialog({
  employee,
  initialDate,
  onClose,
  onDone,
}: {
  /** Set when someone with attendance.manage asks on an employee's behalf. */
  employee?: { id: string; name: string };
  initialDate: string;
  onClose: () => void;
  onDone: (c: Correction) => void;
}) {
  const client = useQueryClient();
  const [values, setValues] = useState({ date: initialDate, in: '', out: '', reason: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const save = useMutation({
    mutationFn: () =>
      apiFetch<Correction>('/v1/attendance/corrections', {
        method: 'POST',
        body: { ...values, ...(employee ? { employeeId: employee.id } : {}) },
      }),
    onSuccess: async (c) => {
      await client.invalidateQueries({ queryKey: ['attendance'] });
      onDone(c);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.length) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      } else {
        setFormError(e instanceof ApiError ? e.detail : 'Something went wrong. Please try again.');
      }
    },
  });
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));

  return (
    <Dialog
      open
      onClose={onClose}
      title={employee ? `Correct attendance for ${employee.name}` : 'Ask for a correction'}
      description="For a forgotten clock-in or clock-out, or a reader that failed. It goes to the manager for approval."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="correction-form" disabled={save.isPending}>
            Send for approval
          </Button>
        </>
      }
    >
      <form
        id="correction-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setErrors({});
          setFormError(undefined);
          save.mutate();
        }}
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <Field id="correction-date" label="Day" error={errors.date}>
          <Input
            id="correction-date"
            type="date"
            value={values.date}
            onChange={(e) => set({ date: e.target.value })}
            aria-invalid={errors.date ? true : undefined}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="correction-in"
            label="Clock-in time"
            error={errors.in}
            hint="Leave empty if it was right"
          >
            <Input
              id="correction-in"
              type="time"
              value={values.in}
              onChange={(e) => set({ in: e.target.value })}
              aria-invalid={errors.in ? true : undefined}
            />
          </Field>
          <Field id="correction-out" label="Clock-out time" error={errors.out}>
            <Input
              id="correction-out"
              type="time"
              value={values.out}
              onChange={(e) => set({ out: e.target.value })}
              aria-invalid={errors.out ? true : undefined}
            />
          </Field>
        </div>
        <Field id="correction-reason" label="What happened" error={errors.reason}>
          <Input
            id="correction-reason"
            value={values.reason}
            onChange={(e) => set({ reason: e.target.value })}
            aria-invalid={errors.reason ? true : undefined}
          />
        </Field>
      </form>
    </Dialog>
  );
}
