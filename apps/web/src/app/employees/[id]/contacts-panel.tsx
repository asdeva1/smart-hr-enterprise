'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { emergencyContactSchema, type EmergencyContactInput } from '@smart-hr/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading } from '@/components/ui/page-header';
import { applyFieldErrors, errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { employeeKeys, type EmergencyContact, type Employee } from '@/lib/employees';

export function ContactsPanel({ employee: e }: { employee: Employee }) {
  const client = useQueryClient();
  const contacts = useQuery({
    queryKey: employeeKeys.contacts(e.id),
    queryFn: () => apiFetch<EmergencyContact[]>(`/v1/employees/${e.id}/contacts`),
  });
  const [editing, setEditing] = useState<EmergencyContact | 'new' | null>(null);
  const [error, setError] = useState<string>();
  const remove = useMutation({
    mutationFn: (contactId: string) =>
      apiFetch(`/v1/employees/${e.id}/contacts/${contactId}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: employeeKeys.contacts(e.id) }),
    onError: (err) => setError(errorMessage(err)),
  });
  const canEdit = e.can.manage && e.status !== 'EXITED';

  if (contacts.isPending) return <Loading />;
  if (contacts.isError) return <Alert tone="error">{errorMessage(contacts.error)}</Alert>;
  return (
    <section aria-labelledby="contacts-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="contacts-heading" className="font-semibold">
          Emergency contacts
        </h2>
        {canEdit && contacts.data.length < 5 && (
          <Button size="sm" onClick={() => setEditing('new')}>
            Add contact
          </Button>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {contacts.data.length === 0 ? (
        <EmptyState title="No emergency contacts yet" />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {contacts.data.map((c) => (
            <li key={c.id} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
              <span className="flex items-center justify-between gap-2">
                <strong>{c.name}</strong>
                {c.isPrimary && <Badge tone="info">Primary</Badge>}
              </span>
              <span className="text-[13px] text-muted-foreground">{c.relationship}</span>
              <span className="tabular-nums">{c.phone}</span>
              {c.email && <span className="text-[13px] break-all">{c.email}</span>}
              {canEdit && (
                <span className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                    Edit<span className="sr-only"> {c.name}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(c.id)}
                  >
                    Remove<span className="sr-only"> {c.name}</span>
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ContactDialog
          employeeId={e.id}
          contact={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function ContactDialog({
  employeeId,
  contact,
  onClose,
}: {
  employeeId: string;
  contact: EmergencyContact | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [formError, setFormError] = useState<string>();
  const form = useForm<EmergencyContactInput, unknown, z.output<typeof emergencyContactSchema>>({
    resolver: zodResolver(emergencyContactSchema),
    defaultValues: {
      name: contact?.name ?? '',
      relationship: contact?.relationship ?? '',
      phone: contact?.phone ?? '',
      email: contact?.email ?? '',
      isPrimary: contact?.isPrimary ?? false,
    },
  });
  const save = useMutation({
    mutationFn: (body: z.output<typeof emergencyContactSchema>) =>
      apiFetch(`/v1/employees/${employeeId}/contacts${contact ? `/${contact.id}` : ''}`, {
        method: contact ? 'PUT' : 'POST',
        body,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: employeeKeys.contacts(employeeId) });
      onClose();
    },
    onError: (err) => {
      if (!applyFieldErrors(err, form.setError)) setFormError(errorMessage(err));
    },
  });
  const errors = form.formState.errors;
  return (
    <Dialog
      open
      onClose={onClose}
      title={contact ? 'Edit contact' : 'Add emergency contact'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="contact-form" disabled={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="contact-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((v) => save.mutate(v))}
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <Field id="c-name" label="Name" error={errors.name?.message}>
          <Input autoFocus {...fieldAria('c-name', errors.name?.message)} {...form.register('name')} />
        </Field>
        <Field id="c-relationship" label="Relationship" error={errors.relationship?.message}>
          <Input
            placeholder="e.g. Spouse, Parent"
            {...fieldAria('c-relationship', errors.relationship?.message)}
            {...form.register('relationship')}
          />
        </Field>
        <Field id="c-phone" label="Phone" error={errors.phone?.message}>
          <Input type="tel" {...fieldAria('c-phone', errors.phone?.message)} {...form.register('phone')} />
        </Field>
        <Field id="c-email" label="Email (optional)" error={errors.email?.message}>
          <Input type="email" {...fieldAria('c-email', errors.email?.message)} {...form.register('email')} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" {...form.register('isPrimary')} />
          Primary contact
        </label>
      </form>
    </Dialog>
  );
}
