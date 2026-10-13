'use client';

import { useBranches, useCompanies, useDepartments, type ScopeType } from '@/lib/admin';
import { Field } from './ui/field';
import { Select } from './ui/select';

/** Chooses where a role applies: the whole organisation, or one company, branch or department. */
export function ScopePicker({
  idPrefix,
  scopeType,
  scopeId,
  onChange,
  error,
}: {
  idPrefix: string;
  scopeType: ScopeType;
  scopeId: string;
  onChange: (scopeType: ScopeType, scopeId: string) => void;
  error?: string | undefined;
}) {
  const companies = useCompanies();
  const branches = useBranches();
  const departments = useDepartments();
  const options =
    scopeType === 'COMPANY'
      ? (companies.data ?? []).filter((c) => c.status === 'ACTIVE')
      : scopeType === 'BRANCH'
        ? (branches.data ?? []).filter((b) => b.status === 'ACTIVE')
        : scopeType === 'DEPARTMENT'
          ? (departments.data ?? []).filter((d) => d.status === 'ACTIVE')
          : [];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id={`${idPrefix}-scope-type`} label="Applies to">
        <Select
          id={`${idPrefix}-scope-type`}
          value={scopeType}
          onChange={(e) => onChange(e.target.value as ScopeType, '')}
        >
          <option value="TENANT">Whole organisation</option>
          <option value="COMPANY">One company</option>
          <option value="BRANCH">One branch</option>
          <option value="DEPARTMENT">One department (and sub-departments)</option>
        </Select>
      </Field>
      {scopeType !== 'TENANT' && (
        <Field
          id={`${idPrefix}-scope-id`}
          label={scopeType === 'COMPANY' ? 'Company' : scopeType === 'BRANCH' ? 'Branch' : 'Department'}
          error={error}
        >
          <Select
            id={`${idPrefix}-scope-id`}
            value={scopeId}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${idPrefix}-scope-id-error` : undefined}
            onChange={(e) => onChange(scopeType, e.target.value)}
          >
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </div>
  );
}
