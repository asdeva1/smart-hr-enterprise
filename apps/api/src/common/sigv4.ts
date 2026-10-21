import { createHash, createHmac } from 'node:crypto';

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

export const EMPTY_SHA256 = sha256('');
export const sha256Hex = sha256;

export interface SigV4Input {
  method: 'GET' | 'PUT' | 'POST';
  url: URL;
  body: string | Uint8Array;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
  /** Further headers to send and sign (for example `content-type`, `x-amz-content-sha256`). Names in lower case. */
  headers?: Record<string, string>;
  /** S3 signs the path as it is; every other service encodes each segment a second time. */
  doubleEncodePath: boolean;
  now?: Date;
}

/**
 * AWS Signature Version 4 for one request. Returns every header to send (the signature included) except `host`,
 * which the HTTP client sets itself from the URL.
 */
export function signV4(input: SigV4Input): Record<string, string> {
  const { url, region, service } = input;
  const stamp = (input.now ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = {
    ...(input.headers ?? {}),
    host: url.host,
    'x-amz-date': stamp,
    ...(input.sessionToken ? { 'x-amz-security-token': input.sessionToken } : {}),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]!.trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const path = input.doubleEncodePath
    ? url.pathname
        .split('/')
        .map((seg) =>
          encodeURIComponent(seg).replace(
            /[!'()*]/g,
            (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
          ),
        )
        .join('/')
    : url.pathname;
  const query = [...url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const payloadHash = headers['x-amz-content-sha256'] ?? sha256(input.body);
  const canonical = [input.method, path, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), region), service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  const { host: _host, ...send } = headers;
  return {
    ...send,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
