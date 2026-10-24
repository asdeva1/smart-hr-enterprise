'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EmployeePicker } from '@/components/employees/employee-picker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorMessage, useBranches, useCompanies, useDepartments } from '@/lib/admin';
import { ApiError, apiFetch } from '@/lib/api';
import { useLookupValues } from '@/lib/configuration';
import { recruitmentKeys, type Opening } from '@/lib/recruitment';

/** Drafts a new opening, or changes one that isn't closed. */
export function OpeningDialog({
  opening,
  onClose,
  onDone,
}: {
  opening?: Opening;
  onClose: () => void;
  onDone: (o: Opening) => void;
}) {
  const client = useQueryClient();
  const companies = useCompanies();
  const branches = useBranches();
  const departments = useDepartments();
  const designations = useLookupValues('designation');
  const [values, setValues] = useState({
    title: opening?.title ?? '',
    companyId: opening?.company.id ?? '',
    branchId: opening?.branch?.id ?? '',
    departmentId: opening?.department?.id ?? '',
    designationId: opening?.designation?.id ?? '',
    positions: String(opening?.positions ?? 1),
    description: opening?.description ?? '',
  });
  const [manager, setManager] = useState<{ id: string; name: string } | null>(opening?.hiringManager ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));
  const companyId = values.companyId || companies.data?.[0]?.id || '';
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: values.title,
        branchId: values.branchId || null,
        departmentId: values.departmentId || null,
        designationId: values.designationId || null,
        hiringManagerId: manager?.id ?? null,
        positions: Number(values.positions),
        description: values.description,
      };
      return opening
        ? apiFetch<Opening>(`/v1/recruitment/openings/${opening.id}`, { method: 'PATCH', body })
        : apiFetch<Opening>('/v1/recruitment/openings', { method: 'POST', body: { ...body, companyId } });
    },
    onSuccess: async (o) => {
      await client.invalidateQueries({ queryKey: recruitmentKeys.all });
      onDone(o);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.length) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
      } else setFormError(errorMessage(e));
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={opening ? `Edit ${opening.code}` : 'New opening'}
      {...(opening
        ? {}
        : {
            description:
              'Saved as a draft. Send it for approval when it’s ready; it takes candidates once approved.',
          })}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="opening-form" disabled={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="opening-form"
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
        <Field id="op-title" label="Job title" error={errors.title}>
          <Input
            {...fieldAria('op-title', errors.title)}
            value={values.title}
            onChange={(e) => set({ title: e.target.value })}
          />
        </Field>
        {!opening && (companies.data?.length ?? 0) !== 1 && (
          <Field id="op-company" label="Company" error={errors.companyId}>
            <Select
              id="op-company"
              value={companyId}
              onChange={(e) => set({ companyId: e.target.value, branchId: '', departmentId: '' })}
            >
              {(companies.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field id="op-branch" label="Branch (optional)" error={errors.branchId}>
          <Select id="op-branch" value={values.branchId} onChange={(e) => set({ branchId: e.target.value })}>
            <option value="">Any</option>
            {(branches.data ?? [])
              .filter((b) => b.companyId === (opening?.company.id ?? companyId))
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field id="op-department" label="Department (optional)" error={errors.departmentId}>
          <Select
            id="op-department"
            value={values.departmentId}
            onChange={(e) => set({ departmentId: e.target.value })}
          >
            <option value="">None</option>
            {(departments.data ?? [])
              .filter((d) => d.companyId === (opening?.company.id ?? companyId))
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field id="op-designation" label="Designation (optional)">
          <Select
            id="op-designation"
            value={values.designationId}
            onChange={(e) => set({ designationId: e.target.value })}
          >
            <option value="">None</option>
            {(designations.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="op-manager" label="Hiring manager (optional)" error={errors.hiringManagerId}>
          <EmployeePicker id="op-manager" value={manager} onChange={setManager} />
        </Field>
        <Field id="op-positions" label="Positions" error={errors.positions}>
          <Input
            {...fieldAria('op-positions', errors.positions)}
            type="number"
            min={1}
            value={values.positions}
            onChange={(e) => set({ positions: e.target.value })}
          />
        </Field>
        <Field id="op-description" label="Description" error={errors.description}>
          <textarea
            {...fieldAria('op-description', errors.description)}
            rows={5}
            className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm aria-[invalid=true]:border-danger"
            value={values.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </Field>
      </form>
    </Dialog>
  );
}
