'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError, apiFetch } from '@/lib/api';
import { todayIso } from '@/lib/employees';
import { days, useLeaveTypes, type LeaveRequest } from '@/lib/leave';

interface Preview {
  days: number;
  available: number | null;
  afterwards: number | null;
}

/**
 * Applies for leave. The day count and the balance afterwards are worked out by the API as the dates change,
 * so weekly offs and holidays are handled exactly as they will be when the request is made.
 */
export function ApplyDialog({
  employee,
  onClose,
  onDone,
}: {
  /** Set when someone with leave.manage applies on an employee's behalf. */
  employee?: { id: string; name: string };
  onClose: () => void;
  onDone: (r: LeaveRequest) => void;
}) {
  const client = useQueryClient();
  const types = useLeaveTypes();
  const active = (types.data ?? []).filter((t) => t.status === 'ACTIVE');
  const [values, setValues] = useState({
    leaveTypeId: '',
    from: todayIso(),
    to: todayIso(),
    halfDay: '' as '' | 'FIRST_HALF' | 'SECOND_HALF',
    reason: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));
  const type = active.find((t) => t.id === values.leaveTypeId);
  const singleDay = values.from === values.to;
  const halfDay = singleDay && type?.allowHalfDay ? values.halfDay : '';
  const ready = !!values.leaveTypeId && !!values.from && !!values.to && values.to >= values.from;

  const preview = useQuery({
    queryKey: ['leave', 'preview', employee?.id, values.leaveTypeId, values.from, values.to, halfDay],
    queryFn: () =>
      apiFetch<Preview>('/v1/leave/preview', {
        method: 'POST',
        body: {
          leaveTypeId: values.leaveTypeId,
          from: values.from,
          to: values.to,
          ...(halfDay ? { halfDay } : {}),
          ...(employee ? { employeeId: employee.id } : {}),
        },
      }),
    enabled: ready,
    retry: false,
  });

  const save = useMutation({
    mutationFn: () =>
      apiFetch<LeaveRequest>('/v1/leave/requests', {
        method: 'POST',
        body: {
          leaveTypeId: values.leaveTypeId,
          from: values.from,
          to: values.to,
          halfDay: halfDay || null,
          reason: values.reason,
          ...(employee ? { employeeId: employee.id } : {}),
        },
      }),
    onSuccess: async (r) => {
      await client.invalidateQueries({ queryKey: ['leave'] });
      await client.invalidateQueries({ queryKey: ['attendance'] });
      onDone(r);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.length && e.code === 'VALIDATION_FAILED') {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      } else {
        setFormError(e instanceof ApiError ? e.detail : 'Something went wrong. Please try again.');
      }
    },
  });

  const previewError = preview.error instanceof ApiError ? preview.error.detail : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={employee ? `Apply for leave for ${employee.name}` : 'Apply for leave'}
      description="It goes to the manager for approval. Weekly offs and holidays in between aren’t counted unless the leave type says so."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="leave-form" disabled={save.isPending}>
            Send for approval
          </Button>
        </>
      }
    >
      <form
        id="leave-form"
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
        <Field id="leave-type" label="Leave type" error={errors.leaveTypeId}>
          <Select
            id="leave-type"
            value={values.leaveTypeId}
            onChange={(e) => set({ leaveTypeId: e.target.value })}
            aria-invalid={errors.leaveTypeId ? true : undefined}
          >
            <option value="">Choose…</option>
            {active.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.paid ? '' : ' (unpaid)'}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="leave-from" label="From" error={errors.from}>
            <Input
              id="leave-from"
              type="date"
              value={values.from}
              onChange={(e) =>
                set({ from: e.target.value, ...(values.to < e.target.value ? { to: e.target.value } : {}) })
              }
              aria-invalid={errors.from ? true : undefined}
            />
          </Field>
          <Field id="leave-to" label="To" error={errors.to}>
            <Input
              id="leave-to"
              type="date"
              min={values.from}
              value={values.to}
              onChange={(e) => set({ to: e.target.value })}
              aria-invalid={errors.to ? true : undefined}
            />
          </Field>
        </div>
        {singleDay && type?.allowHalfDay && (
          <Field id="leave-half" label="How much of the day" error={errors.halfDay}>
            <Select
              id="leave-half"
              value={values.halfDay}
              onChange={(e) => set({ halfDay: e.target.value as typeof values.halfDay })}
            >
              <option value="">Full day</option>
              <option value="FIRST_HALF">Morning only</option>
              <option value="SECOND_HALF">Afternoon only</option>
            </Select>
          </Field>
        )}
        <Field id="leave-reason" label="Reason" error={errors.reason}>
          <Input
            id="leave-reason"
            value={values.reason}
            onChange={(e) => set({ reason: e.target.value })}
            aria-invalid={errors.reason ? true : undefined}
          />
        </Field>
        <p role="status" aria-live="polite" className="text-[13px]">
          {!ready ? (
            <span className="text-muted-foreground">Choose a leave type and dates to see the days.</span>
          ) : preview.isPending ? (
            <span className="text-muted-foreground">Working out the days…</span>
          ) : previewError ? (
            <span className="text-danger">{previewError}</span>
          ) : preview.data ? (
            <>
              Uses <strong>{days(preview.data.days)}</strong>
              {preview.data.available !== null &&
                preview.data.afterwards !== null &&
                ` of ${days(preview.data.available)} available, leaving ${days(preview.data.afterwards)}.`}
              {preview.data.afterwards !== null && preview.data.afterwards < 0 && (
                <span className="text-danger"> That’s more than is available.</span>
              )}
            </>
          ) : null}
        </p>
      </form>
    </Dialog>
  );
}
