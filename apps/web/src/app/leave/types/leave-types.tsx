'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { ApiError, apiFetch, type SessionView } from '@/lib/api';
import { ACCRUAL_LABEL, days, leaveKeys, useLeaveTypes, type Accrual, type LeaveType } from '@/lib/leave';
import { LeaveTabs } from '../leave-tabs';

export function LeaveTypes({ session }: { session: SessionView }) {
  const types = useLeaveTypes();
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null);
  const [notice, setNotice] = useState<string>();

  return (
    <>
      <PageHeader
        title="Leave"
        description="The kinds of leave people can take, how much, and the rules for each."
        actions={<Button onClick={() => setEditing('new')}>New leave type</Button>}
      />
      <LeaveTabs session={session} active="/leave/types" />
      {notice && <Alert tone="success">{notice}</Alert>}
      {types.isPending ? (
        <Loading />
      ) : types.isError ? (
        <Alert tone="error">{errorMessage(types.error)}</Alert>
      ) : types.data.length === 0 ? (
        <EmptyState title="No leave types yet">
          Add the leave your organisation offers, for example Earned leave, Casual leave and Sick leave.
        </EmptyState>
      ) : (
        <Table label="Leave types">
          <thead>
            <tr>
              <Th>Leave type</Th>
              <Th>Credit</Th>
              <Th className="text-right">Per year</Th>
              <Th className="text-right">Carry forward</Th>
              <Th>Rules</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {types.data.map((t) => (
              <tr key={t.id}>
                <Td>
                  <span className="font-medium">{t.name}</span>{' '}
                  <span className="font-mono text-xs text-muted-foreground">{t.code}</span>
                  {!t.paid && <Badge tone="neutral"> Unpaid</Badge>}
                  {t.status === 'ARCHIVED' && <Badge tone="neutral"> Archived</Badge>}
                </Td>
                <Td>{ACCRUAL_LABEL[t.accrual]}</Td>
                <Td className="text-right tabular-nums">{t.accrual === 'NONE' ? '—' : t.quotaDays}</Td>
                <Td className="text-right tabular-nums">{t.carryForwardMaxDays || '—'}</Td>
                <Td className="text-[13px] text-muted-foreground">{rules(t)}</Td>
                <Td className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                    Edit<span className="sr-only"> {t.name}</span>
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && (
        <TypeDialog
          type={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(t, created) => {
            setEditing(null);
            setNotice(created ? `${t.name} added.` : `${t.name} saved.`);
          }}
        />
      )}
    </>
  );
}

function rules(t: LeaveType): string {
  const parts = [
    t.allowHalfDay ? 'half days allowed' : 'full days only',
    t.includeNonWorkingDays ? 'weekly offs and holidays count' : null,
    t.minNoticeDays ? `${days(t.minNoticeDays)}’ notice` : null,
    t.maxDaysPerRequest ? `at most ${days(t.maxDaysPerRequest)} at a time` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function TypeDialog({
  type,
  onClose,
  onDone,
}: {
  type: LeaveType | null;
  onClose: () => void;
  onDone: (t: LeaveType, created: boolean) => void;
}) {
  const client = useQueryClient();
  const [v, setV] = useState({
    code: type?.code ?? '',
    name: type?.name ?? '',
    description: type?.description ?? '',
    paid: type?.paid ?? true,
    accrual: type?.accrual ?? 'YEARLY',
    quotaDays: String(type?.quotaDays ?? 12),
    carryForwardMaxDays: String(type?.carryForwardMaxDays ?? 0),
    allowHalfDay: type?.allowHalfDay ?? true,
    includeNonWorkingDays: type?.includeNonWorkingDays ?? false,
    minNoticeDays: String(type?.minNoticeDays ?? 0),
    maxDaysPerRequest: type?.maxDaysPerRequest ? String(type.maxDaysPerRequest) : '',
    archived: type?.status === 'ARCHIVED',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const noBalance = v.accrual === 'NONE';
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: v.name,
        description: v.description,
        paid: v.paid,
        accrual: v.accrual,
        quotaDays: noBalance ? 0 : v.quotaDays,
        carryForwardMaxDays: noBalance ? 0 : v.carryForwardMaxDays,
        allowHalfDay: v.allowHalfDay,
        includeNonWorkingDays: v.includeNonWorkingDays,
        minNoticeDays: v.minNoticeDays,
        maxDaysPerRequest: v.maxDaysPerRequest,
      };
      return type
        ? apiFetch<LeaveType>(`/v1/leave/types/${type.id}`, {
            method: 'PATCH',
            body: { ...body, status: v.archived ? 'ARCHIVED' : 'ACTIVE' },
          })
        : apiFetch<LeaveType>('/v1/leave/types', { method: 'POST', body: { ...body, code: v.code } });
    },
    onSuccess: async (t) => {
      await client.invalidateQueries({ queryKey: leaveKeys.types });
      onDone(t, !type);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.length) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      } else {
        setFormError(e instanceof ApiError ? e.detail : 'Something went wrong. Please try again.');
      }
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={type ? `Edit ${type.name}` : 'New leave type'}
      description="Changes apply from now on. Leave already approved keeps the days it used."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="type-form" disabled={save.isPending}>
            {type ? 'Save leave type' : 'Create leave type'}
          </Button>
        </>
      }
    >
      <form
        id="type-form"
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
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <Field id="type-code" label="Code" error={errors.code}>
            <Input
              id="type-code"
              className="font-mono"
              disabled={!!type}
              value={v.code}
              onChange={(e) => set({ code: e.target.value })}
            />
          </Field>
          <Field id="type-name" label="Name" error={errors.name}>
            <Input id="type-name" value={v.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
        </div>
        <Field id="type-accrual" label="How days are credited" error={errors.accrual}>
          <Select
            id="type-accrual"
            value={v.accrual}
            onChange={(e) => set({ accrual: e.target.value as Accrual })}
          >
            <option value="YEARLY">All at the start of the year (pro-rated for joiners)</option>
            <option value="MONTHLY">A twelfth each month</option>
            <option value="NONE">No balance (for example unpaid leave)</option>
          </Select>
        </Field>
        {!noBalance && (
          <div className="grid grid-cols-2 gap-3">
            <Field id="type-quota" label="Days per year" error={errors.quotaDays}>
              <Input
                id="type-quota"
                inputMode="decimal"
                value={v.quotaDays}
                onChange={(e) => set({ quotaDays: e.target.value })}
              />
            </Field>
            <Field
              id="type-carry"
              label="Carry forward up to"
              error={errors.carryForwardMaxDays}
              hint="Unused days beyond this lapse"
            >
              <Input
                id="type-carry"
                inputMode="decimal"
                value={v.carryForwardMaxDays}
                onChange={(e) => set({ carryForwardMaxDays: e.target.value })}
              />
            </Field>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field id="type-notice" label="Notice (days)" error={errors.minNoticeDays} hint="0 = any time">
            <Input
              id="type-notice"
              inputMode="numeric"
              value={v.minNoticeDays}
              onChange={(e) => set({ minNoticeDays: e.target.value })}
            />
          </Field>
          <Field
            id="type-max"
            label="Longest request (days)"
            error={errors.maxDaysPerRequest}
            hint="Empty = no limit"
          >
            <Input
              id="type-max"
              inputMode="numeric"
              value={v.maxDaysPerRequest}
              onChange={(e) => set({ maxDaysPerRequest: e.target.value })}
            />
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="sr-only">Rules</legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={v.paid} onChange={(e) => set({ paid: e.target.checked })} /> Paid
            leave
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={v.allowHalfDay}
              onChange={(e) => set({ allowHalfDay: e.target.checked })}
            />{' '}
            Can be taken as half days
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={v.includeNonWorkingDays}
              onChange={(e) => set({ includeNonWorkingDays: e.target.checked })}
            />{' '}
            Weekly offs and holidays inside a request count as leave
          </label>
          {type && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={v.archived}
                onChange={(e) => set({ archived: e.target.checked })}
              />{' '}
              Archived (no new requests)
            </label>
          )}
        </fieldset>
      </form>
    </Dialog>
  );
}
