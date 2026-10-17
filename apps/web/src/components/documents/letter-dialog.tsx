'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { documentKeys, useTemplates, type EmployeeDocument } from '@/lib/documents';

/** Makes a PDF letter from a template, after showing the text filled in for this employee. */
export function LetterDialog({
  employee,
  onClose,
  onDone,
}: {
  employee: { id: string; name: string };
  onClose: () => void;
  onDone: (d: EmployeeDocument) => void;
}) {
  const client = useQueryClient();
  const templates = useTemplates();
  const [templateId, setTemplateId] = useState('');
  const [share, setShare] = useState(true);
  const preview = useQuery({
    queryKey: ['documents', 'letter-preview', employee.id, templateId],
    queryFn: () =>
      apiFetch<{ title: string; body: string }>(
        `/v1/documents/employee/${employee.id}/letters/preview?templateId=${templateId}`,
      ),
    enabled: !!templateId,
  });
  const make = useMutation({
    mutationFn: () =>
      apiFetch<EmployeeDocument>(`/v1/documents/employee/${employee.id}/letters`, {
        method: 'POST',
        body: { templateId, visibleToEmployee: share },
      }),
    onSuccess: async (d) => {
      await client.invalidateQueries({ queryKey: documentKeys.all });
      onDone(d);
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Make a letter for ${employee.name}`}
      description="The letter is made as a PDF and added to their documents. You can then send it for signature."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!templateId || make.isPending || !preview.isSuccess}
            onClick={() => make.mutate()}
          >
            Make letter
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {make.isError && <Alert tone="error">{errorMessage(make.error)}</Alert>}
        {templates.isError ? (
          <Alert tone="error">{errorMessage(templates.error)}</Alert>
        ) : templates.data?.length === 0 ? (
          <Alert tone="info">No letter templates yet. Add one under Documents, Letter templates.</Alert>
        ) : (
          <Field id="letter-template" label="Template">
            <Select id="letter-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Choose a template</option>
              {(templates.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {preview.isError && <Alert tone="error">{errorMessage(preview.error)}</Alert>}
        {preview.data && (
          <section
            aria-label="Letter preview"
            className="max-h-72 overflow-y-auto rounded-md border border-border bg-muted/40 p-4"
          >
            <p className="mb-2 font-semibold">{preview.data.title}</p>
            <p className="text-[13px] whitespace-pre-wrap">{preview.data.body}</p>
          </section>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
          Share with {employee.name}
        </label>
      </div>
    </Dialog>
  );
}
