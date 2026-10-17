'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, Loading } from '@/components/ui/page-header';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import {
  documentKeys,
  fileSize,
  fileUrl,
  SIGNATURE_STATUS_LABEL,
  SIGNATURE_STATUS_TONE,
  useEmployeeDocuments,
  useMyDocuments,
  type DocumentList,
  type EmployeeDocument,
} from '@/lib/documents';
import { formatDay, todayIso } from '@/lib/employees';
import { can, hasFeature } from '@/lib/permissions';
import { LetterDialog } from './letter-dialog';
import { SendDialog } from './send-dialog';
import { UploadDialog } from './upload-dialog';

/**
 * Documents on one employee's record: for HR on the profile, and for the employee themself under My
 * documents. What shows and what can be done follows what the API says this member may do.
 */
export function DocumentsPanel({
  session,
  employeeId,
  signer,
}: {
  session: SessionView;
  /** Unset = my own record. */
  employeeId?: string;
  /** The employee's sign-in, offered as the first signer. */
  signer?: { membershipId: string; name: string; email: string } | null;
}) {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const own = useMyDocuments(!employeeId);
  const theirs = useEmployeeDocuments(employeeId ?? '', showArchived ? 'ALL' : 'ACTIVE', !!employeeId);
  const list = employeeId ? theirs : own;
  const [dialog, setDialog] = useState<'upload' | 'letter' | null>(null);
  const [sending, setSending] = useState<EmployeeDocument | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();

  if (!employeeId && own.isSuccess && own.data.employee === null) {
    return (
      <EmptyState title="Your account isn’t linked to an employee record">
        Documents live on employee records. Ask HR to link your account to yours.
      </EmptyState>
    );
  }
  if (list.isPending) return <Loading />;
  if (list.isError) return <Alert tone="error">{errorMessage(list.error)}</Alert>;
  const data: DocumentList = list.data;
  const employee = data.employee!;
  const staff = data.can.manage;
  const esign = hasFeature(session, 'esignature');

  return (
    <section aria-label="Documents" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {data.can.upload && <Button onClick={() => setDialog('upload')}>Add a document</Button>}
        {staff && can(session, 'documents.manage') && (
          <Button variant="outline" onClick={() => setDialog('letter')}>
            Make a letter
          </Button>
        )}
        {staff && (
          <label className="ml-auto flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
        )}
      </div>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {data.items.length === 0 ? (
        <EmptyState title="No documents yet">
          {data.can.upload ? 'Add contracts, certificates, ID copies and letters here.' : null}
        </EmptyState>
      ) : (
        <DocumentsTable
          items={data.items}
          esign={esign}
          onSend={setSending}
          onArchived={(d) => setNotice({ tone: 'success', text: `“${d.title}” archived.` })}
          onError={(text) => setNotice({ tone: 'error', text })}
        />
      )}
      {dialog === 'upload' && (
        <UploadDialog
          employee={employee}
          staff={staff}
          onClose={() => setDialog(null)}
          onDone={(d) => {
            setDialog(null);
            setNotice({ tone: 'success', text: `“${d.title}” added.` });
          }}
        />
      )}
      {dialog === 'letter' && (
        <LetterDialog
          employee={employee}
          onClose={() => setDialog(null)}
          onDone={(d) => {
            setDialog(null);
            setNotice({ tone: 'success', text: `“${d.title}” made and added.` });
          }}
        />
      )}
      {sending && (
        <SendDialog
          document={sending}
          defaultSigner={signer ?? null}
          onClose={() => setSending(null)}
          onDone={(r) => router.push(`/documents/signatures/${r.id}`)}
        />
      )}
    </section>
  );
}

export function DocumentsTable({
  items,
  esign,
  showEmployee = false,
  onSend,
  onArchived,
  onError,
}: {
  items: EmployeeDocument[];
  esign: boolean;
  showEmployee?: boolean;
  onSend?: (d: EmployeeDocument) => void;
  onArchived?: (d: EmployeeDocument) => void;
  onError?: (text: string) => void;
}) {
  const client = useQueryClient();
  const archive = useMutation({
    mutationFn: (d: EmployeeDocument) =>
      apiFetch<EmployeeDocument>(`/v1/documents/${d.id}/archive`, { method: 'POST' }),
    onSuccess: async (d) => {
      await client.invalidateQueries({ queryKey: documentKeys.all });
      onArchived?.(d);
    },
    onError: (e) => onError?.(errorMessage(e)),
  });
  const today = todayIso();
  return (
    <Table label="Documents">
      <thead>
        <tr>
          {showEmployee && <Th>Employee</Th>}
          <Th>Document</Th>
          <Th>Category</Th>
          <Th>Expires</Th>
          <Th>Status</Th>
          <Th className="text-right">Actions</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((d) => (
          <tr key={d.id}>
            {showEmployee && (
              <Td>
                <Link
                  href={`/employees/${d.employee.id}?tab=documents`}
                  className="text-primary hover:underline"
                >
                  {d.employee.name}
                </Link>
              </Td>
            )}
            <Td>
              <span className="font-medium">{d.title}</span>
              <span className="block text-xs text-muted-foreground">
                {d.file.name} · {fileSize(d.file.size)}
                {!d.visibleToEmployee && ' · HR only'}
              </span>
            </Td>
            <Td>{d.categoryLabel}</Td>
            <Td>
              {d.expiresOn ? (
                <span className={d.expiresOn < today ? 'font-medium text-danger' : undefined}>
                  {formatDay(d.expiresOn)}
                  {d.expiresOn < today && ' (expired)'}
                </span>
              ) : (
                '—'
              )}
            </Td>
            <Td>
              <span className="flex flex-wrap gap-1">
                {d.status === 'ARCHIVED' && <Badge>Archived</Badge>}
                {d.signature && (
                  <Link href={`/documents/signatures/${d.signature.id}`}>
                    <Badge tone={SIGNATURE_STATUS_TONE[d.signature.status]}>
                      {SIGNATURE_STATUS_LABEL[d.signature.status]}
                    </Badge>
                  </Link>
                )}
              </span>
            </Td>
            <Td className="text-right">
              <span className="inline-flex flex-wrap justify-end gap-1.5">
                <a
                  href={fileUrl(`/v1/documents/${d.id}/file`)}
                  className="inline-flex h-8 items-center rounded-md border border-input bg-card px-3 text-[13px] font-medium hover:bg-muted"
                  aria-label={`Download ${d.title}`}
                >
                  Download
                </a>
                {esign && onSend && d.can.sendForSignature && d.signature?.status !== 'PENDING' && (
                  <Button variant="outline" size="sm" onClick={() => onSend(d)}>
                    Send for signature
                  </Button>
                )}
                {d.can.manage && d.status === 'ACTIVE' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={archive.isPending}
                    aria-label={`Archive ${d.title}`}
                    onClick={() => archive.mutate(d)}
                  >
                    Archive
                  </Button>
                )}
              </span>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
