'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { updateEmployeeSchema, type UpdateEmployeeInput } from '@smart-hr/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { applyFieldErrors, errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { employeeKeys, GENDER_LABEL, type Employee, type Gender } from '@/lib/employees';
import { LookupSelect } from '../new/new-employee-form';

/** Corrections only. Career changes (transfer, promotion, manager) go through "Change employment". */
export function EditDetailsDialog({
  employee: e,
  onClose,
  onSaved,
}: {
  employee: Employee;
  onClose: () => void;
  onSaved: () => void;
}) {
  const client = useQueryClient();
  const [formError, setFormError] = useState<string>();
  const form = useForm<UpdateEmployeeInput, unknown, z.output<typeof updateEmployeeSchema>>({
    resolver: zodResolver(updateEmployeeSchema),
    defaultValues: {
      version: e.version,
      firstName: e.firstName,
      lastName: e.lastName,
      preferredName: e.preferredName ?? '',
      workEmail: e.workEmail ?? '',
      personalEmail: e.personalEmail ?? '',
      phone: e.phone ?? '',
      dateOfBirth: e.dateOfBirth ?? '',
      gender: e.gender ?? '',
      employmentTypeId: e.employmentTypeId ?? '',
      dateOfJoining: e.dateOfJoining,
      probationEndDate: e.probationEndDate ?? '',
    },
  });
  const save = useMutation({
    mutationFn: (body: z.output<typeof updateEmployeeSchema>) =>
      apiFetch<Employee>(`/v1/employees/${e.id}`, { method: 'PATCH', body }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: employeeKeys.all });
      onSaved();
    },
    onError: (err) => {
      if (!applyFieldErrors(err, form.setError)) setFormError(errorMessage(err));
    },
  });
  const errors = form.formState.errors;
  const err = (name: keyof UpdateEmployeeInput) => errors[name]?.message;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit details"
      description="For corrections. Use “Change employment” for transfers, promotions and manager changes, so they show in the history."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="edit-employee" disabled={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="edit-employee"
        noValidate
        className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4"
        onSubmit={form.handleSubmit((v) => {
          setFormError(undefined);
          save.mutate(v);
        })}
      >
        {formError && (
          <div className="col-span-full">
            <Alert tone="error">{formError}</Alert>
          </div>
        )}
        <Field id="edit-firstName" label="First name" error={err('firstName')}>
          <Input {...fieldAria('edit-firstName', err('firstName'))} {...form.register('firstName')} />
        </Field>
        <Field id="edit-lastName" label="Last name" error={err('lastName')}>
          <Input {...fieldAria('edit-lastName', err('lastName'))} {...form.register('lastName')} />
        </Field>
        <Field id="edit-preferredName" label="Preferred first name" error={err('preferredName')}>
          <Input
            {...fieldAria('edit-preferredName', err('preferredName'))}
            {...form.register('preferredName')}
          />
        </Field>
        <Field id="edit-dateOfBirth" label="Date of birth" error={err('dateOfBirth')}>
          <Input
            type="date"
            {...fieldAria('edit-dateOfBirth', err('dateOfBirth'))}
            {...form.register('dateOfBirth')}
          />
        </Field>
        <Field id="edit-gender" label="Gender" error={err('gender')}>
          <Select {...fieldAria('edit-gender', err('gender'))} {...form.register('gender')}>
            <option value="">Not set</option>
            {(Object.keys(GENDER_LABEL) as Gender[]).map((g) => (
              <option key={g} value={g}>
                {GENDER_LABEL[g]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="edit-workEmail" label="Work email" error={err('workEmail')}>
          <Input
            type="email"
            {...fieldAria('edit-workEmail', err('workEmail'))}
            {...form.register('workEmail')}
          />
        </Field>
        <Field id="edit-personalEmail" label="Personal email" error={err('personalEmail')}>
          <Input
            type="email"
            {...fieldAria('edit-personalEmail', err('personalEmail'))}
            {...form.register('personalEmail')}
          />
        </Field>
        <Field id="edit-phone" label="Mobile" error={err('phone')}>
          <Input type="tel" {...fieldAria('edit-phone', err('phone'))} {...form.register('phone')} />
        </Field>
        <LookupSelect
          id="edit-employmentTypeId"
          list="employment_type"
          label="Employment type"
          error={err('employmentTypeId')}
          {...form.register('employmentTypeId')}
        />
        <Field id="edit-dateOfJoining" label="Date of joining" error={err('dateOfJoining')}>
          <Input
            type="date"
            {...fieldAria('edit-dateOfJoining', err('dateOfJoining'))}
            {...form.register('dateOfJoining')}
          />
        </Field>
        <Field id="edit-probationEndDate" label="Probation ends" error={err('probationEndDate')}>
          <Input
            type="date"
            {...fieldAria('edit-probationEndDate', err('probationEndDate'))}
            {...form.register('probationEndDate')}
          />
        </Field>
      </form>
    </Dialog>
  );
}
