/**
 * API client for the browser. Only NEXT_PUBLIC_API_URL reaches the browser; no secrets live in this app.
 * The session cookie is HttpOnly and travels automatically; the CSRF token is read from its cookie and
 * echoed in a header on every state-changing request.
 */

export interface Readiness {
  status: 'ok' | 'unavailable';
  checks: { database: 'up' | 'down'; redis: 'up' | 'down' };
}

export class ApiUnreachableError extends Error {
  constructor() {
    super('The API could not be reached');
    this.name = 'ApiUnreachableError';
  }
}

/** A problem-details error from the API. `code` is stable; `detail` is safe to show to the user. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string,
    readonly fieldErrors: { path: string; message: string }[] = [],
  ) {
    super(detail);
    this.name = 'ApiError';
  }

  /** True when the user must sign in (again) before retrying. */
  get needsSignIn(): boolean {
    return this.status === 401 && ['UNAUTHENTICATED', 'SESSION_EXPIRED', 'MFA_REQUIRED'].includes(this.code);
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

export function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
}

export function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (UNSAFE.has(method)) {
    const csrf = readCookie('shr_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(`${apiBaseUrl()}${path}`, {
      method,
      headers,
      credentials: 'include',
      cache: 'no-store',
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new ApiUnreachableError();
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
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

export async function fetchReadiness(fetchImpl: typeof fetch = fetch): Promise<Readiness> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiBaseUrl()}/health/ready`, {
      credentials: 'include',
      cache: 'no-store',
    });
  } catch {
    throw new ApiUnreachableError();
  }
  // 503 still carries a readiness report worth showing.
  if (response.ok || response.status === 503) {
    return (await response.json()) as Readiness;
  }
  throw new ApiUnreachableError();
}

/** Shape returned by /v1/auth/session and the sign-in endpoints. */
export interface SessionView {
  user: { id: string; email: string; displayName: string; isPlatformAdmin: boolean; mfaEnabled: boolean };
  mfaPending: boolean;
  activeTenant: {
    id: string;
    name: string;
    isTenantAdmin: boolean;
    /** For showing and hiding UI only. The API checks permissions on every request. */
    permissions: string[];
    mfaEnrolmentRequired: boolean;
  } | null;
  memberships: { tenantId: string; name: string; isTenantAdmin: boolean }[];
  expiresAt: string;
  absoluteExpiresAt: string;
}

/** Only allows same-site relative paths as post-sign-in destinations, so `next=` can't redirect off-site. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}
