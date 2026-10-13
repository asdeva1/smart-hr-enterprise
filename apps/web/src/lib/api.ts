/**
 * Minimal API client. Only NEXT_PUBLIC_API_URL reaches the browser; no secrets live in this app.
 * Phase 2 replaces this with a typed client generated from the API's OpenAPI document.
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

export function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
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
