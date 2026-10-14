'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { provisionTenantSchema } from '@smart-hr/validation';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { applyFieldErrors, errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { usePlans } from '@/lib/plan';
import { suggestSlug } from '@/lib/platform';

interface Created {
  id: string;
  slug: string;
  name: string;
  ownerInvited: boolean;
}

/** The provisioning schema plus the plan picker; the API validates the plan version itself. */
const formSchema = provisionTenantSchema.omit({ subscription: true }).extend({
  planVersionId: z.string(),
  planStatus: z.enum(['TRIAL', 'ACTIVE']),
});
type FormValues = z.input<typeof formSchema>;

export function NewOrganisationDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (created: Created) => void;
}) {
  const plans = usePlans();
  const [error, setError] = useState<string>();
  const [slugEdited, setSlugEdited] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      slug: '',
      ownerEmail: '',
      ownerName: '',
      planVersionId: '',
      planStatus: 'TRIAL',
    },
  });
  const create = useMutation({
    mutationFn: ({ planVersionId, planStatus, ...rest }: FormValues) =>
      apiFetch<Created>('/v1/platform/tenants', {
        method: 'POST',
        body: { ...rest, ...(planVersionId ? { subscription: { planVersionId, status: planStatus } } : {}) },
      }),
    onSuccess: onCreated,
    onError: (e) => {
      if (!applyFieldErrors(e, form.setError)) setError(errorMessage(e));
    },
  });
  const errors = form.formState.errors;
  const versions = (plans.data ?? []).flatMap((p) =>
    p.versions
      .filter((v) => v.status === 'PUBLISHED')
      .map((v) => ({ id: v.id, label: `${p.name} v${v.version}`, trialDays: v.trialDays })),
  );
  const planVersionId = useWatch({ control: form.control, name: 'planVersionId' });
  const chosen = versions.find((v) => v.id === planVersionId);

  return (
    <Dialog
      open
      onClose={onClose}
      title="New organisation"
      description="The owner gets an email to set their password. An existing account is simply added as owner."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-organisation" disabled={create.isPending}>
            Create organisation
          </Button>
        </>
      }
    >
      <form
        id="new-organisation"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((v) => {
          setError(undefined);
          create.mutate(v);
        })}
      >
        {error && <Alert tone="error">{error}</Alert>}
        <Field id="org-name" label="Organisation name" error={errors.name?.message}>
          <Input
            {...fieldAria('org-name', errors.name?.message)}
            {...form.register('name', {
              onChange: (e: { target: { value: string } }) => {
                if (!slugEdited) form.setValue('slug', suggestSlug(e.target.value));
              },
            })}
          />
        </Field>
        <Field
          id="org-slug"
          label="Address"
          error={errors.slug?.message}
          hint="Unique, lower case, e.g. acme-health"
        >
          <Input
            {...fieldAria('org-slug', errors.slug?.message, 'hint')}
            className="font-mono"
            {...form.register('slug', { onChange: () => setSlugEdited(true) })}
          />
        </Field>
        <Field id="org-owner-name" label="Owner’s name" error={errors.ownerName?.message}>
          <Input
            {...fieldAria('org-owner-name', errors.ownerName?.message)}
            {...form.register('ownerName')}
          />
        </Field>
        <Field id="org-owner-email" label="Owner’s email" error={errors.ownerEmail?.message}>
          <Input
            type="email"
            {...fieldAria('org-owner-email', errors.ownerEmail?.message)}
            {...form.register('ownerEmail')}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="org-plan" label="Plan (optional)">
            <Select id="org-plan" {...form.register('planVersionId')}>
              <option value="">No plan yet</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="org-plan-status" label="Start as">
            <Select id="org-plan-status" disabled={!chosen} {...form.register('planStatus')}>
              <option value="TRIAL" disabled={!chosen?.trialDays}>
                Trial{chosen?.trialDays ? ` (${chosen.trialDays} days)` : ''}
              </option>
              <option value="ACTIVE">Active</option>
            </Select>
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
