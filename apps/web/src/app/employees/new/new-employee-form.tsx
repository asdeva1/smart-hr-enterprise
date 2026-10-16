'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createEmployeeSchema, type CreateEmployeeInput } from '@smart-hr/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { EmployeePicker } from '@/components/employees/employee-picker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { applyFieldErrors, errorMessage, useBranches, useCompanies, useDepartments } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { useLookupValues } from '@/lib/configuration';
import { employeeKeys, GENDER_LABEL, todayIso, type Employee, type Gender } from '@/lib/employees';

type Output = z.output<typeof createEmployeeSchema>;

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 rounded-lg border border-border bg-card p-5 md:grid-cols-[220px_1fr]">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">{children}</div>
    </section>
  );
}

export function LookupSelect({
  id,
  list,
  label,
  error,
  ...props
}: {
  id: string;
  list: string;
  label: string;
  error?: string | undefined;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const values = useLookupValues(list);
  return (
    <Field id={id} label={label} error={error}>
      <Select {...fieldAria(id, error)} {...props}>
        <option value="">Not set</option>
        {values.data?.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function NewEmployeeForm() {
  const router = useRouter();
  const client = useQueryClient();
  const companies = useCompanies();
  const branches = useBranches();
  const departments = useDepartments();
  const [manager, setManager] = useState<{ id: string; name: string } | null>(null);
  const [formError, setFormError] = useState<string>();
  const form = useForm<CreateEmployeeInput, unknown, Output>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: {
      employeeCode: '',
      firstName: '',
      lastName: '',
      preferredName: '',
      workEmail: '',
      personalEmail: '',
      phone: '',
      dateOfBirth: '',
      gender: '',
      companyId: '',
      branchId: '',
      departmentId: '',
      designationId: '',
      gradeId: '',
      employmentTypeId: '',
      costCentreId: '',
      dateOfJoining: todayIso(),
      probationEndDate: '',
    } as unknown as CreateEmployeeInput,
  });
  const companyId = useWatch({ control: form.control, name: 'companyId' });
  const errors = form.formState.errors;
  const create = useMutation({
    mutationFn: (body: Output) => apiFetch<Employee>('/v1/employees', { method: 'POST', body }),
    onSuccess: async (e) => {
      await client.invalidateQueries({ queryKey: employeeKeys.all });
      router.push(`/employees/${e.id}?created=1`);
    },
    onError: (e) => {
      if (!applyFieldErrors(e, form.setError)) setFormError(errorMessage(e));
    },
  });
  const activeCompanies = companies.data?.filter((c) => c.status === 'ACTIVE') ?? [];
  const reg = (name: keyof CreateEmployeeInput) => form.register(name);
  const err = (name: keyof CreateEmployeeInput) => errors[name]?.message;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[13px]">
        <Link href="/employees" className="text-primary hover:underline">
          Employees
        </Link>{' '}
        <span className="text-muted-foreground">/ Add employee</span>
      </nav>
      <PageHeader title="Add employee" description="Only the name, company and joining date are required." />
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((v) => {
          setFormError(undefined);
          create.mutate({ ...v, managerId: manager?.id ?? null });
        })}
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <Section title="Personal" description="As on their identity documents.">
          <Field id="firstName" label="First name" error={err('firstName')}>
            <Input autoFocus {...fieldAria('firstName', err('firstName'))} {...reg('firstName')} />
          </Field>
          <Field id="lastName" label="Last name" error={err('lastName')}>
            <Input {...fieldAria('lastName', err('lastName'))} {...reg('lastName')} />
          </Field>
          <Field id="preferredName" label="Preferred first name (optional)" error={err('preferredName')}>
            <Input {...fieldAria('preferredName', err('preferredName'))} {...reg('preferredName')} />
          </Field>
          <Field id="dateOfBirth" label="Date of birth (optional)" error={err('dateOfBirth')}>
            <Input type="date" {...fieldAria('dateOfBirth', err('dateOfBirth'))} {...reg('dateOfBirth')} />
          </Field>
          <Field id="gender" label="Gender (optional)" error={err('gender')}>
            <Select {...fieldAria('gender', err('gender'))} {...reg('gender')}>
              <option value="">Not set</option>
              {(Object.keys(GENDER_LABEL) as Gender[]).map((g) => (
                <option key={g} value={g}>
                  {GENDER_LABEL[g]}
                </option>
              ))}
            </Select>
          </Field>
        </Section>
        <Section title="Contact" description="The work email is where a sign-in invitation would go.">
          <Field id="workEmail" label="Work email (optional)" error={err('workEmail')}>
            <Input type="email" {...fieldAria('workEmail', err('workEmail'))} {...reg('workEmail')} />
          </Field>
          <Field id="personalEmail" label="Personal email (optional)" error={err('personalEmail')}>
            <Input
              type="email"
              {...fieldAria('personalEmail', err('personalEmail'))}
              {...reg('personalEmail')}
            />
          </Field>
          <Field id="phone" label="Mobile (optional)" error={err('phone')}>
            <Input type="tel" {...fieldAria('phone', err('phone'))} {...reg('phone')} />
          </Field>
        </Section>
        <Section title="Job" description="Where they work and who they report to.">
          <Field id="companyId" label="Company" error={err('companyId')}>
            <Select
              {...fieldAria('companyId', err('companyId'))}
              {...form.register('companyId', {
                onChange: () => {
                  form.setValue('branchId', '');
                  form.setValue('departmentId', '');
                },
              })}
            >
              <option value="">Choose…</option>
              {activeCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="branchId" label="Branch (optional)" error={err('branchId')}>
            <Select disabled={!companyId} {...fieldAria('branchId', err('branchId'))} {...reg('branchId')}>
              <option value="">Not set</option>
              {branches.data
                ?.filter((b) => b.companyId === companyId && b.status === 'ACTIVE')
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field id="departmentId" label="Department (optional)" error={err('departmentId')}>
            <Select
              disabled={!companyId}
              {...fieldAria('departmentId', err('departmentId'))}
              {...reg('departmentId')}
            >
              <option value="">Not set</option>
              {departments.data
                ?.filter((d) => d.companyId === companyId && d.status === 'ACTIVE')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </Select>
          </Field>
          <LookupSelect
            id="designationId"
            list="designation"
            label="Designation (optional)"
            error={err('designationId')}
            {...reg('designationId')}
          />
          <LookupSelect
            id="gradeId"
            list="grade"
            label="Grade (optional)"
            error={err('gradeId')}
            {...reg('gradeId')}
          />
          <LookupSelect
            id="employmentTypeId"
            list="employment_type"
            label="Employment type (optional)"
            error={err('employmentTypeId')}
            {...reg('employmentTypeId')}
          />
          <LookupSelect
            id="costCentreId"
            list="cost_centre"
            label="Cost centre (optional)"
            error={err('costCentreId')}
            {...reg('costCentreId')}
          />
          <Field id="manager" label="Manager (optional)" error={err('managerId')}>
            <EmployeePicker id="manager" value={manager} onChange={setManager} invalid={!!err('managerId')} />
          </Field>
        </Section>
        <Section
          title="Employment"
          description="Leave the employee number empty to get the next one (EMP-0001, …)."
        >
          <Field id="dateOfJoining" label="Date of joining" error={err('dateOfJoining')}>
            <Input
              type="date"
              {...fieldAria('dateOfJoining', err('dateOfJoining'))}
              {...reg('dateOfJoining')}
            />
          </Field>
          <Field id="probationEndDate" label="Probation ends (optional)" error={err('probationEndDate')}>
            <Input
              type="date"
              {...fieldAria('probationEndDate', err('probationEndDate'))}
              {...reg('probationEndDate')}
            />
          </Field>
          <Field id="employeeCode" label="Employee number (optional)" error={err('employeeCode')}>
            <Input
              className="font-mono"
              {...fieldAria('employeeCode', err('employeeCode'))}
              {...reg('employeeCode')}
            />
          </Field>
        </Section>
        <div className="flex justify-end gap-2">
          <Link
            href="/employees"
            className="inline-flex items-center px-3 text-[13px] font-medium text-primary hover:underline"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Adding…' : 'Add employee'}
          </Button>
        </div>
      </form>
    </>
  );
}
