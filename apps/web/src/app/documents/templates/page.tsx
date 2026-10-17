'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { ApiError, apiFetch } from '@/lib/api';
import {
  CATEGORY_LABEL,
  documentKeys,
  LETTER_PLACEHOLDERS,
  useTemplates,
  type DocumentCategory,
  type LetterTemplate,
} from '@/lib/documents';
import { DocumentsPage, DocumentsTabs } from '../documents-page';

export default function TemplatesPage() {
  const templates = useTemplates(true);
  const [editing, setEditing] = useState<LetterTemplate | 'new' | null>(null);
  const [notice, setNotice] = useState<string>();
  return (
    <DocumentsPage permission="documents.configure">
      {(session) => (
        <>
          <PageHeader
            title="Documents"
            description="Letter templates. HR fills them in for an employee to make a PDF letter."
            actions={<Button onClick={() => setEditing('new')}>Add template</Button>}
          />
          <DocumentsTabs session={session} active="/documents/templates" />
          {notice && <Alert tone="success">{notice}</Alert>}
          {templates.isPending ? (
            <Loading />
          ) : templates.isError ? (
            <Alert tone="error">{errorMessage(templates.error)}</Alert>
          ) : templates.data.length === 0 ? (
            <EmptyState title="No letter templates yet">
              Add appointment, confirmation, experience or address-proof letters.
            </EmptyState>
          ) : (
            <Table label="Letter templates">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Category</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {templates.data.map((t) => (
                  <tr key={t.id}>
                    <Td className="font-medium">{t.name}</Td>
                    <Td>{CATEGORY_LABEL[t.category]}</Td>
                    <Td>
                      <Badge tone={t.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {t.status === 'ACTIVE' ? 'In use' : 'Archived'}
                      </Badge>
                    </Td>
                    <Td className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setEditing(t)}>
                        Edit
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {editing && (
            <TemplateDialog
              template={editing === 'new' ? null : editing}
              onClose={() => setEditing(null)}
              onDone={(t) => {
                setEditing(null);
                setNotice(`“${t.name}” saved.`);
              }}
            />
          )}
        </>
      )}
    </DocumentsPage>
  );
}

function TemplateDialog({
  template,
  onClose,
  onDone,
}: {
  template: LetterTemplate | null;
  onClose: () => void;
  onDone: (t: LetterTemplate) => void;
}) {
  const client = useQueryClient();
  const [values, setValues] = useState<{
    name: string;
    category: DocumentCategory;
    body: string;
    status: 'ACTIVE' | 'ARCHIVED';
  }>({
    name: template?.name ?? '',
    category: template?.category ?? 'LETTER',
    body: template?.body ?? '',
    status: template?.status ?? 'ACTIVE',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));
  const save = useMutation({
    mutationFn: () =>
      template
        ? apiFetch<LetterTemplate>(`/v1/documents/templates/${template.id}`, {
            method: 'PATCH',
            body: values,
          })
        : apiFetch<LetterTemplate>('/v1/documents/templates', {
            method: 'POST',
            body: { name: values.name, category: values.category, body: values.body },
          }),
    onSuccess: async (t) => {
      await client.invalidateQueries({ queryKey: documentKeys.all });
      onDone(t);
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
      title={template ? `Edit “${template.name}”` : 'Add a letter template'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="template-form" disabled={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="template-form"
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
        <Field id="tpl-name" label="Name" error={errors.name}>
          <Input
            {...fieldAria('tpl-name', errors.name)}
            value={values.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <Field id="tpl-category" label="Category">
          <Select
            id="tpl-category"
            value={values.category}
            onChange={(e) => set({ category: e.target.value as DocumentCategory })}
          >
            {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="tpl-body" label="Letter text" error={errors.body}>
          <textarea
            {...fieldAria('tpl-body', errors.body)}
            rows={10}
            className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-[13px] aria-[invalid=true]:border-danger"
            value={values.body}
            onChange={(e) => set({ body: e.target.value })}
          />
        </Field>
        <details className="text-[13px]">
          <summary className="cursor-pointer font-medium">Placeholders you can use</summary>
          <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {Object.entries(LETTER_PLACEHOLDERS).map(([key, label]) => (
              <li key={key}>
                <code className="rounded bg-muted px-1">{`{{${key}}}`}</code> {label}
              </li>
            ))}
          </ul>
        </details>
        {template && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.status === 'ARCHIVED'}
              onChange={(e) => set({ status: e.target.checked ? 'ARCHIVED' : 'ACTIVE' })}
            />
            Archived (no longer offered when making letters)
          </label>
        )}
      </form>
    </Dialog>
  );
}
