/** A small client for the public API endpoints. They answer problem-details JSON on failure. */
export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** A sentence a visitor can act on. */
  message: string | null;
  fieldErrors: Record<string, string>;
}

export async function postJson<T = unknown>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : null;
    if (res.ok) return { ok: true, status: res.status, data: json as T, message: null, fieldErrors: {} };
    const problem = (json ?? {}) as { detail?: string; errors?: { path?: string; message?: string }[] };
    const fieldErrors: Record<string, string> = {};
    for (const e of problem.errors ?? []) if (e.path && e.message) fieldErrors[e.path] = e.message;
    return {
      ok: false,
      status: res.status,
      data: null,
      message: messageFor(res.status, problem.detail),
      fieldErrors,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      data: null,
      message: 'We couldn’t reach the server. Check your connection and try again.',
      fieldErrors: {},
    };
  }
}

function messageFor(status: number, detail?: string): string {
  if (status === 429) return 'Too many attempts. Please wait a few minutes and try again.';
  if (status === 404) return 'This isn’t available yet. Please contact us and we’ll set you up.';
  return detail ?? 'Something went wrong. Please try again.';
}
