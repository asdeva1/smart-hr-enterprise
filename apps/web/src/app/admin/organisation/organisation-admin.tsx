'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  createBranchSchema,
  createCompanySchema,
  createDepartmentSchema,
  updateBranchSchema,
  updateCompanySchema,
  updateDepartmentSchema,
} from '@smart-hr/validation';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import {
  adminKeys,
  applyFieldErrors,
  errorMessage,
  timeZones,
  useBranches,
  useCompanies,
  useDepartments,
  type Branch,
  type Company,
  type Department,
  type RecordStatus,
} from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { can } from '@/lib/permissions';

type Tab = 'companies' | 'branches' | 'departments';

function StatusBadge({ status }: { status: RecordStatus }) {
  return status === 'ACTIVE' ? <Badge tone="success">Active</Badge> : <Badge>Archived</Badge>;
}

/** Form-level error banner plus the submit/cancel footer used by every dialog here. */
function DialogActions({
  busy,
  onCancel,
  submitLabel,
}: {
  busy: boolean;
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <div className="mt-6 flex justify-end gap-2">
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </Button>
    </div>
  );
}

function ArchiveToggle({ id, label, register }: { id: string; label: string; register: object }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2.5 text-sm">
      <input id={id} type="checkbox" className="size-[18px] accent-primary" {...register} />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------- companies

type CompanyCreate = z.input<typeof createCompanySchema>;
type CompanyUpdate = z.input<typeof updateCompanySchema>;

function CompanyForm({ company, onDone }: { company?: Company | undefined; onDone: () => void }) {
  const client = useQueryClient();
  const [formError, setFormError] = useState<string>();
  const editing = !!company;
  const form = useForm<CompanyCreate & { archived?: boolean }>({
    resolver: zodResolver(editing ? (updateCompanySchema as never) : createCompanySchema),
    defaultValues: company
      ? {
          code: company.code,
          name: company.name,
          legalName: company.legalName ?? '',
          country: company.country,
          baseCurrency: company.baseCurrency,
          timezone: company.timezone,
          archived: company.status === 'ARCHIVED',
        }
      : { code: '', name: '', legalName: '', country: 'IN', baseCurrency: 'INR', timezone: 'Asia/Kolkata' },
  });
  const { errors, isSubmitting } = form.formState;
  const zones = useMemo(() => timeZones(), []);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    try {
      if (company) {
        const body: CompanyUpdate = {
          name: values.name,
          legalName: values.legalName,
          country: values.country,
          baseCurrency: values.baseCurrency,
          timezone: values.timezone,
          status: form.getValues('archived') ? 'ARCHIVED' : 'ACTIVE',
        };
        await apiFetch(`/v1/org/companies/${company.id}`, { method: 'PATCH', body });
      } else {
        await apiFetch('/v1/org/companies', { method: 'POST', body: values });
      }
      await client.invalidateQueries({ queryKey: adminKeys.companies });
      onDone();
    } catch (error) {
      if (!applyFieldErrors(error, form.setError)) setFormError(errorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && <Alert tone="error">{formError}</Alert>}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Field
          id="company-code"
          label="Code"
          error={errors.code?.message}
          hint="Short and unique, e.g. ACME-IN"
        >
          <Input
            disabled={editing}
            {...fieldAria('company-code', errors.code?.message)}
            {...form.register('code')}
          />
        </Field>
        <Field id="company-name" label="Name" error={errors.name?.message}>
          <Input autoFocus {...fieldAria('company-name', errors.name?.message)} {...form.register('name')} />
        </Field>
      </div>
      <Field id="company-legal" label="Legal name (optional)" error={errors.legalName?.message}>
        <Input {...fieldAria('company-legal', errors.legalName?.message)} {...form.register('legalName')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="company-country" label="Country" error={errors.country?.message} hint="2-letter code">
          <Input
            maxLength={2}
            {...fieldAria('company-country', errors.country?.message)}
            {...form.register('country')}
          />
        </Field>
        <Field
          id="company-currency"
          label="Base currency"
          error={errors.baseCurrency?.message}
          hint="3-letter code"
        >
          <Input
            maxLength={3}
            {...fieldAria('company-currency', errors.baseCurrency?.message)}
            {...form.register('baseCurrency')}
          />
        </Field>
      </div>
      <Field id="company-tz" label="Time zone" error={errors.timezone?.message}>
        <Select {...fieldAria('company-tz', errors.timezone?.message)} {...form.register('timezone')}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
      </Field>
      {editing && (
        <ArchiveToggle id="company-archived" label="Archived" register={form.register('archived')} />
      )}
      <DialogActions
        busy={isSubmitting}
        onCancel={onDone}
        submitLabel={editing ? 'Save changes' : 'Add company'}
      />
    </form>
  );
}

function CompaniesTab({ canManage }: { canManage: boolean }) {
  const { data, isPending, isError, error } = useCompanies();
  const [editing, setEditing] = useState<Company | 'new' | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <div>
          <Button onClick={() => setEditing('new')}>Add company</Button>
        </div>
      )}
      {isPending ? (
        <Loading />
      ) : isError ? (
        <Alert tone="error">{errorMessage(error)}</Alert>
      ) : data.length === 0 ? (
        <EmptyState title="No companies yet">
          {canManage
            ? 'Add your first legal entity to start building the organisation.'
            : 'Nothing you can see yet.'}
        </EmptyState>
      ) : (
        <Table label="Companies">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Country</Th>
              <Th>Currency</Th>
              <Th>Time zone</Th>
              <Th>Status</Th>
              {canManage && (
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id}>
                <Td className="font-mono text-[13px]">{c.code}</Td>
                <Td>
                  <div className="font-semibold">{c.name}</div>
                  {c.legalName && <div className="text-xs text-muted-foreground">{c.legalName}</div>}
                </Td>
                <Td>{c.country}</Td>
                <Td>{c.baseCurrency}</Td>
                <Td>{c.timezone}</Td>
                <Td>
                  <StatusBadge status={c.status} />
                </Td>
                {canManage && (
                  <Td className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(c)}
                      aria-label={`Edit ${c.name}`}
                    >
                      Edit
                    </Button>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add company' : `Edit ${editing?.name ?? ''}`}
      >
        {editing !== null && (
          <CompanyForm company={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />
        )}
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------- branches

type BranchCreate = z.input<typeof createBranchSchema>;

function BranchForm({
  branch,
  companies,
  onDone,
}: {
  branch?: Branch | undefined;
  companies: Company[];
  onDone: () => void;
}) {
  const client = useQueryClient();
  const [formError, setFormError] = useState<string>();
  const editing = !!branch;
  const zones = useMemo(() => timeZones(), []);
  const form = useForm<BranchCreate & { archived?: boolean }>({
    resolver: zodResolver(editing ? (updateBranchSchema as never) : createBranchSchema),
    defaultValues: branch
      ? {
          companyId: branch.companyId,
          code: branch.code,
          name: branch.name,
          city: branch.city ?? '',
          country: branch.country,
          timezone: branch.timezone,
          archived: branch.status === 'ARCHIVED',
        }
      : { companyId: companies[0]?.id ?? '', code: '', name: '', city: '', country: null, timezone: null },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const common = {
      name: values.name,
      city: values.city,
      country: values.country || null,
      timezone: values.timezone || null,
    };
    try {
      if (branch) {
        await apiFetch(`/v1/org/branches/${branch.id}`, {
          method: 'PATCH',
          body: { ...common, status: form.getValues('archived') ? 'ARCHIVED' : 'ACTIVE' },
        });
      } else {
        await apiFetch('/v1/org/branches', {
          method: 'POST',
          body: { ...common, companyId: values.companyId, code: values.code },
        });
      }
      await client.invalidateQueries({ queryKey: adminKeys.branches });
      onDone();
    } catch (error) {
      if (!applyFieldErrors(error, form.setError)) setFormError(errorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && <Alert tone="error">{formError}</Alert>}
      <Field id="branch-company" label="Company" error={errors.companyId?.message}>
        <Select
          disabled={editing}
          {...fieldAria('branch-company', errors.companyId?.message)}
          {...form.register('companyId')}
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Field id="branch-code" label="Code" error={errors.code?.message}>
          <Input
            disabled={editing}
            {...fieldAria('branch-code', errors.code?.message)}
            {...form.register('code')}
          />
        </Field>
        <Field id="branch-name" label="Name" error={errors.name?.message}>
          <Input autoFocus {...fieldAria('branch-name', errors.name?.message)} {...form.register('name')} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="branch-city" label="City (optional)" error={errors.city?.message}>
          <Input {...fieldAria('branch-city', errors.city?.message)} {...form.register('city')} />
        </Field>
        <Field
          id="branch-country"
          label="Country (optional)"
          error={errors.country?.message}
          hint="2-letter code"
        >
          <Input
            maxLength={2}
            {...fieldAria('branch-country', errors.country?.message)}
            {...form.register('country')}
          />
        </Field>
      </div>
      <Field id="branch-tz" label="Time zone" error={errors.timezone?.message}>
        <Select {...fieldAria('branch-tz', errors.timezone?.message)} {...form.register('timezone')}>
          <option value="">Same as the company</option>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
      </Field>
      {editing && (
        <ArchiveToggle id="branch-archived" label="Archived" register={form.register('archived')} />
      )}
      <DialogActions
        busy={isSubmitting}
        onCancel={onDone}
        submitLabel={editing ? 'Save changes' : 'Add branch'}
      />
    </form>
  );
}

function BranchesTab({ canManage }: { canManage: boolean }) {
  const branches = useBranches();
  const companies = useCompanies();
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const companyName = (id: string) => companies.data?.find((c) => c.id === id)?.name ?? '—';
  const activeCompanies = companies.data?.filter((c) => c.status === 'ACTIVE') ?? [];

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <div>
          <Button onClick={() => setEditing('new')} disabled={activeCompanies.length === 0}>
            Add branch
          </Button>
          {companies.isSuccess && activeCompanies.length === 0 && (
            <p className="mt-2 text-[13px] text-muted-foreground">Add a company first.</p>
          )}
        </div>
      )}
      {branches.isPending ? (
        <Loading />
      ) : branches.isError ? (
        <Alert tone="error">{errorMessage(branches.error)}</Alert>
      ) : branches.data.length === 0 ? (
        <EmptyState title="No branches yet" />
      ) : (
        <Table label="Branches">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Company</Th>
              <Th>City</Th>
              <Th>Time zone</Th>
              <Th>Status</Th>
              {canManage && (
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              )}
            </tr>
          </thead>
          <tbody>
            {branches.data.map((b) => (
              <tr key={b.id}>
                <Td className="font-mono text-[13px]">{b.code}</Td>
                <Td className="font-semibold">{b.name}</Td>
                <Td>{companyName(b.companyId)}</Td>
                <Td>{b.city ?? '—'}</Td>
                <Td>{b.timezone ?? <span className="text-muted-foreground">Company’s</span>}</Td>
                <Td>
                  <StatusBadge status={b.status} />
                </Td>
                {canManage && (
                  <Td className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(b)}
                      aria-label={`Edit ${b.name}`}
                    >
                      Edit
                    </Button>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add branch' : `Edit ${editing?.name ?? ''}`}
      >
        {editing !== null && (
          <BranchForm
            branch={editing === 'new' ? undefined : editing}
            companies={editing === 'new' ? activeCompanies : (companies.data ?? [])}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------- departments

type DepartmentCreate = z.input<typeof createDepartmentSchema>;

/** Departments in tree order with their depth, for indented display and parent pickers. */
function treeOrder(departments: Department[]): { dept: Department; depth: number }[] {
  const children = new Map<string | null, Department[]>();
  const ids = new Set(departments.map((d) => d.id));
  for (const d of departments) {
    // A parent the user can't see is treated as top level.
    const key = d.parentId && ids.has(d.parentId) ? d.parentId : null;
    children.set(key, [...(children.get(key) ?? []), d]);
  }
  const out: { dept: Department; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const d of children.get(parent) ?? []) {
      out.push({ dept: d, depth });
      walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function DepartmentForm({
  department,
  companies,
  departments,
  onDone,
}: {
  department?: Department | undefined;
  companies: Company[];
  departments: Department[];
  onDone: () => void;
}) {
  const client = useQueryClient();
  const [formError, setFormError] = useState<string>();
  const editing = !!department;
  const form = useForm<DepartmentCreate & { archived?: boolean }>({
    resolver: zodResolver(editing ? (updateDepartmentSchema as never) : createDepartmentSchema),
    defaultValues: department
      ? {
          companyId: department.companyId,
          parentId: department.parentId ?? '',
          code: department.code,
          name: department.name,
          archived: department.status === 'ARCHIVED',
        }
      : { companyId: companies[0]?.id ?? '', parentId: '', code: '', name: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const companyId = useWatch({ control: form.control, name: 'companyId' });
  const parents = treeOrder(
    departments.filter((d) => d.companyId === companyId && d.status === 'ACTIVE'),
  ).filter(({ dept }) => dept.id !== department?.id);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    const parentId = values.parentId || null;
    try {
      if (department) {
        await apiFetch(`/v1/org/departments/${department.id}`, {
          method: 'PATCH',
          body: { name: values.name, parentId, status: form.getValues('archived') ? 'ARCHIVED' : 'ACTIVE' },
        });
      } else {
        await apiFetch('/v1/org/departments', {
          method: 'POST',
          body: { companyId: values.companyId, parentId, code: values.code, name: values.name },
        });
      }
      await client.invalidateQueries({ queryKey: adminKeys.departments });
      onDone();
    } catch (error) {
      if (!applyFieldErrors(error, form.setError)) setFormError(errorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && <Alert tone="error">{formError}</Alert>}
      <Field id="dept-company" label="Company" error={errors.companyId?.message}>
        <Select
          disabled={editing}
          {...fieldAria('dept-company', errors.companyId?.message)}
          {...form.register('companyId')}
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="dept-parent" label="Inside department" error={errors.parentId?.message}>
        <Select {...fieldAria('dept-parent', errors.parentId?.message)} {...form.register('parentId')}>
          <option value="">None — top level</option>
          {parents.map(({ dept, depth }) => (
            <option key={dept.id} value={dept.id}>
              {'— '.repeat(depth)}
              {dept.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Field id="dept-code" label="Code" error={errors.code?.message}>
          <Input
            disabled={editing}
            {...fieldAria('dept-code', errors.code?.message)}
            {...form.register('code')}
          />
        </Field>
        <Field id="dept-name" label="Name" error={errors.name?.message}>
          <Input autoFocus {...fieldAria('dept-name', errors.name?.message)} {...form.register('name')} />
        </Field>
      </div>
      {editing && <ArchiveToggle id="dept-archived" label="Archived" register={form.register('archived')} />}
      <DialogActions
        busy={isSubmitting}
        onCancel={onDone}
        submitLabel={editing ? 'Save changes' : 'Add department'}
      />
    </form>
  );
}

function DepartmentsTab({ canManage }: { canManage: boolean }) {
  const departments = useDepartments();
  const companies = useCompanies();
  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  const companyName = (id: string) => companies.data?.find((c) => c.id === id)?.name ?? '—';
  const activeCompanies = companies.data?.filter((c) => c.status === 'ACTIVE') ?? [];
  const rows = departments.data ? treeOrder(departments.data) : [];

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <div>
          <Button onClick={() => setEditing('new')} disabled={activeCompanies.length === 0}>
            Add department
          </Button>
        </div>
      )}
      {departments.isPending ? (
        <Loading />
      ) : departments.isError ? (
        <Alert tone="error">{errorMessage(departments.error)}</Alert>
      ) : rows.length === 0 ? (
        <EmptyState title="No departments yet" />
      ) : (
        <Table label="Departments">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Company</Th>
              <Th>Status</Th>
              {canManage && (
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ dept, depth }) => (
              <tr key={dept.id}>
                <Td className="font-mono text-[13px]">{dept.code}</Td>
                <Td className="font-semibold">
                  <span style={{ paddingLeft: depth * 20 }} className="inline-flex items-center gap-1.5">
                    {depth > 0 && (
                      <span aria-hidden="true" className="text-muted-foreground">
                        └
                      </span>
                    )}
                    {dept.name}
                  </span>
                </Td>
                <Td>{companyName(dept.companyId)}</Td>
                <Td>
                  <StatusBadge status={dept.status} />
                </Td>
                {canManage && (
                  <Td className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(dept)}
                      aria-label={`Edit ${dept.name}`}
                    >
                      Edit
                    </Button>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add department' : `Edit ${editing?.name ?? ''}`}
      >
        {editing !== null && (
          <DepartmentForm
            department={editing === 'new' ? undefined : editing}
            companies={editing === 'new' ? activeCompanies : (companies.data ?? [])}
            departments={departments.data ?? []}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

export function OrganisationAdmin({ session }: { session: SessionView }) {
  const [tab, setTab] = useState<Tab>('companies');
  const canManage = can(session, 'org.manage');
  return (
    <>
      <PageHeader
        title="Organisation"
        description="Legal entities, their locations and departments. Archived records stay for history."
      />
      <Tabs
        label="Organisation structure"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'companies', label: 'Companies' },
          { value: 'branches', label: 'Branches' },
          { value: 'departments', label: 'Departments' },
        ]}
      />
      {tab === 'companies' && <CompaniesTab canManage={canManage} />}
      {tab === 'branches' && <BranchesTab canManage={canManage} />}
      {tab === 'departments' && <DepartmentsTab canManage={canManage} />}
    </>
  );
}
