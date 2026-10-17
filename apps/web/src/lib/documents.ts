import { useQuery } from '@tanstack/react-query';
import { ApiError, ApiUnreachableError, apiBaseUrl, apiFetch, readCookie } from './api';

export type DocumentCategory =
  'IDENTITY' | 'EDUCATION' | 'EMPLOYMENT' | 'CONTRACT' | 'LETTER' | 'POLICY' | 'MEDICAL' | 'OTHER';

export const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  IDENTITY: 'Identity',
  EDUCATION: 'Education',
  EMPLOYMENT: 'Previous employment',
  CONTRACT: 'Contract',
  LETTER: 'Letter',
  POLICY: 'Policy',
  MEDICAL: 'Medical',
  OTHER: 'Other',
};

export type SignatureStatus = 'PENDING' | 'COMPLETED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
export type SignerStatus = 'WAITING' | 'PENDING' | 'SIGNED' | 'DECLINED';

export interface EmployeeDocument {
  id: string;
  employee: { id: string; name: string; employeeCode: string };
  title: string;
  category: DocumentCategory;
  categoryLabel: string;
  notes: string | null;
  visibleToEmployee: boolean;
  expiresOn: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  file: { name: string; mimeType: string; size: number; sha256: string };
  signature: { id: string; status: SignatureStatus } | null;
  createdAt: string;
  archivedAt: string | null;
  can: { manage: boolean; sendForSignature: boolean };
}

export interface DocumentList {
  employee: { id: string; name: string } | null;
  can: { manage: boolean; upload: boolean };
  items: EmployeeDocument[];
}

export interface LetterTemplate {
  id: string;
  name: string;
  category: DocumentCategory;
  body: string;
  status: 'ACTIVE' | 'ARCHIVED';
  updatedAt: string;
}

export interface SignatureRequest {
  id: string;
  title: string;
  message: string | null;
  status: SignatureStatus;
  sequential: boolean;
  documentSha256: string;
  document: { id: string; title: string };
  employee: { id: string; name: string; employeeCode: string };
  signers: {
    id: string;
    position: number;
    name: string;
    email: string;
    status: SignerStatus;
    signedName: string | null;
    signedAt: string | null;
    declinedAt: string | null;
    declineReason: string | null;
  }[];
  requestedByUserId: string;
  expiresAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  hasSignedCopy: boolean;
  me: { signerId: string; status: SignerStatus } | null;
  can: { sign: boolean; cancel: boolean };
}

/** The placeholders a letter template may use (the API refuses any others). */
export const LETTER_PLACEHOLDERS: Record<string, string> = {
  'employee.name': 'Full name',
  'employee.firstName': 'First name',
  'employee.lastName': 'Last name',
  'employee.code': 'Employee code',
  'employee.designation': 'Designation',
  'employee.department': 'Department',
  'employee.branch': 'Branch',
  'employee.company': 'Company (legal name)',
  'employee.joinDate': 'Date of joining',
  'employee.workEmail': 'Work email',
  'employee.manager': 'Reporting manager',
  'organisation.name': 'Organisation name',
  today: 'Today’s date',
};

export const SIGNATURE_STATUS_LABEL: Record<SignatureStatus, string> = {
  PENDING: 'Out for signature',
  COMPLETED: 'Signed',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Not signed in time',
};
export const SIGNATURE_STATUS_TONE = {
  PENDING: 'info',
  COMPLETED: 'success',
  DECLINED: 'danger',
  CANCELLED: 'neutral',
  EXPIRED: 'warning',
} as const;
export const SIGNER_STATUS_LABEL: Record<SignerStatus, string> = {
  WAITING: 'Waiting for their turn',
  PENDING: 'To sign',
  SIGNED: 'Signed',
  DECLINED: 'Declined',
};

export const documentKeys = {
  all: ['documents'] as const,
  employee: (id: string, status: string) => ['documents', 'employee', id, status] as const,
  mine: ['documents', 'mine'] as const,
  expiring: (days: number) => ['documents', 'expiring', days] as const,
  templates: (archived: boolean) => ['documents', 'templates', archived] as const,
  signatures: (scope: string, status?: string) => ['documents', 'signatures', scope, status ?? ''] as const,
  signature: (id: string) => ['documents', 'signature', id] as const,
};

export const useEmployeeDocuments = (
  employeeId: string,
  status: 'ACTIVE' | 'ALL' = 'ACTIVE',
  enabled = true,
) =>
  useQuery({
    queryKey: documentKeys.employee(employeeId, status),
    queryFn: () => apiFetch<DocumentList>(`/v1/documents/employee/${employeeId}?status=${status}`),
    enabled,
  });

export const useMyDocuments = (enabled = true) =>
  useQuery({
    queryKey: documentKeys.mine,
    queryFn: () => apiFetch<DocumentList>('/v1/documents/me'),
    enabled,
  });

export const useTemplates = (archived = false) =>
  useQuery({
    queryKey: documentKeys.templates(archived),
    queryFn: () => apiFetch<LetterTemplate[]>(`/v1/documents/templates?archived=${archived}`),
  });

export const useSignatures = (scope: 'mine' | 'sent' | 'all', status?: SignatureStatus, enabled = true) =>
  useQuery({
    queryKey: documentKeys.signatures(scope, status),
    queryFn: () =>
      apiFetch<SignatureRequest[]>(`/v1/signatures?scope=${scope}${status ? `&status=${status}` : ''}`),
    enabled,
  });

export const useSignature = (id: string) =>
  useQuery({
    queryKey: documentKeys.signature(id),
    queryFn: () => apiFetch<SignatureRequest>(`/v1/signatures/${id}`),
  });

/** Link that downloads a file from the API (the session cookie goes with it; the API audits it). */
export const fileUrl = (path: string) => `${apiBaseUrl()}${path}`;

/** Sends a file with form fields (multipart), with the same CSRF and error handling as apiFetch. */
export async function apiUpload<T>(
  path: string,
  file: File,
  fields: Record<string, string>,
  fileField = 'file',
): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append(fileField, file);
  const headers: Record<string, string> = {};
  const csrf = readCookie('shr_csrf');
  if (csrf) headers['x-csrf-token'] = csrf;
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method: 'POST',
      body: form,
      headers,
      credentials: 'include',
      cache: 'no-store',
    });
  } catch {
    throw new ApiUnreachableError();
  }
  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    if (response.status === 413) {
      throw new ApiError(413, 'FILE_TOO_LARGE', 'This file is larger than your organisation allows.');
    }
    const problem = (data ?? {}) as {
      code?: string;
      detail?: string;
      title?: string;
      errors?: { path: string; message: string }[];
    };
    throw new ApiError(
      response.status,
      problem.code ?? 'ERROR',
      problem.detail ?? problem.title ?? 'Something went wrong. Please try again.',
      problem.errors ?? [],
    );
  }
  return data as T;
}

/** "120 KB", "2.4 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
