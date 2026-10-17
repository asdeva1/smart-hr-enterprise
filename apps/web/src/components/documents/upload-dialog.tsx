'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import {
  apiUpload,
  CATEGORY_LABEL,
  documentKeys,
  type DocumentCategory,
  type EmployeeDocument,
} from '@/lib/documents';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.txt,.csv';

/**
 * Adds a document to an employee's record. HR can keep a document to themselves and add notes; someone
 * adding to their own record always sees what they added.
 */
export function UploadDialog({
  employee,
  staff,
  onClose,
  onDone,
}: {
  employee: { id: string; name: string };
  staff: boolean;
  onClose: () => void;
  onDone: (d: EmployeeDocument) => void;
}) {
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [values, setValues] = useState({
    title: '',
    category: 'OTHER' as DocumentCategory,
    expiresOn: '',
    visibleToEmployee: true,
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));

  const save = useMutation({
    mutationFn: () =>
      apiUpload<EmployeeDocument>(`/v1/documents/employee/${employee.id}`, file!, {
        title: values.title,
        category: values.category,
        expiresOn: values.expiresOn,
        ...(staff ? { visibleToEmployee: String(values.visibleToEmployee), notes: values.notes } : {}),
      }),
    onSuccess: async (d) => {
      await client.invalidateQueries({ queryKey: documentKeys.all });
      onDone(d);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.length && e.code === 'VALIDATION_FAILED') {
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
      title={staff ? `Add a document for ${employee.name}` : 'Add a document'}
      description="PDF, images, Word, Excel, text or CSV. Files are encrypted when stored."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="upload-form" disabled={save.isPending}>
            {save.isPending ? 'Uploading…' : 'Upload'}
          </Button>
        </>
      }
    >
      <form
        id="upload-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setErrors({});
          setFormError(undefined);
          const next: Record<string, string> = {};
          if (!file) next.file = 'Choose a file';
          if (values.title.trim().length < 2) next.title = 'Give the document a title';
          if (Object.keys(next).length) {
            setErrors(next);
            return;
          }
          save.mutate();
        }}
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <Field id="doc-file" label="File" error={errors.file}>
          <input
            {...fieldAria('doc-file', errors.file)}
            type="file"
            accept={ACCEPT}
            className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-2"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !values.title) set({ title: f.name.replace(/\.[^.]+$/, '') });
            }}
          />
        </Field>
        <Field id="doc-title" label="Title" error={errors.title}>
          <Input
            {...fieldAria('doc-title', errors.title)}
            value={values.title}
            onChange={(e) => set({ title: e.target.value })}
          />
        </Field>
        <Field id="doc-category" label="Category" error={errors.category}>
          <Select
            {...fieldAria('doc-category', errors.category)}
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
        <Field
          id="doc-expires"
          label="Expires on (optional)"
          hint="A reminder goes out before this date."
          error={errors.expiresOn}
        >
          <Input
            {...fieldAria('doc-expires', errors.expiresOn, 'A reminder goes out before this date.')}
            type="date"
            value={values.expiresOn}
            onChange={(e) => set({ expiresOn: e.target.value })}
          />
        </Field>
        {staff && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={values.visibleToEmployee}
                onChange={(e) => set({ visibleToEmployee: e.target.checked })}
              />
              Share with {employee.name}
            </label>
            <Field id="doc-notes" label="Notes for HR (optional)" error={errors.notes}>
              <Input
                {...fieldAria('doc-notes', errors.notes)}
                value={values.notes}
                onChange={(e) => set({ notes: e.target.value })}
              />
            </Field>
          </>
        )}
      </form>
    </Dialog>
  );
}
