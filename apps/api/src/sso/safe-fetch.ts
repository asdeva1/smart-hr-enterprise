import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** True for addresses an outbound request must never reach: loopback, private, link-local, metadata, etc. */
export function isPrivateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const a = address.toLowerCase();
    if (a === '::' || a === '::1') return true;
    if (a.startsWith('::ffff:')) return isPrivateAddress(a.slice(7));
    return a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe8') || a.startsWith('fe9') ||
      a.startsWith('fea') || a.startsWith('feb') || a.startsWith('ff');
  }
  return true;
}

export class UnsafeUrlError extends Error {}

export interface SafeFetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** Tests and local identity providers only: allows http and private addresses. */
  allowPrivateNetwork?: boolean;
}

/**
 * Fetches a URL an administrator typed in. It refuses anything but https, any address on a private network
 * (checked after DNS resolution), redirects, slow answers and large bodies, so the form cannot be used to
 * probe the server's own network.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<{ status: number; text: string }> {
  const url = new URL(rawUrl);
  const priv = options.allowPrivateNetwork === true;
  if (url.protocol !== 'https:' && !(priv && url.protocol === 'http:')) {
    throw new UnsafeUrlError('The address must start with https://');
  }
  if (url.username || url.password) throw new UnsafeUrlError('The address must not contain a username or password');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!priv) {
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
    if (addresses.length === 0) throw new UnsafeUrlError('That address could not be found');
    if (addresses.some((a) => isPrivateAddress(a.address))) {
      throw new UnsafeUrlError('That address points to a private network');
    }
  }
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.body !== undefined ? { body: options.body } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
  });
  const max = options.maxBytes ?? 256 * 1024;
  const reader = response.body?.getReader() as
    | { read(): Promise<unknown>; cancel(): Promise<void> }
    | undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = (await reader.read()) as { done: boolean; value: Uint8Array };
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new UnsafeUrlError('The answer was too large');
    }
    chunks.push(value);
  }
  return { status: response.status, text: Buffer.concat(chunks).toString('utf8') };
}
