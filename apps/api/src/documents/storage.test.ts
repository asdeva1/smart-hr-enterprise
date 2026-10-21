import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3FileStorage } from './storage.js';

const KEY = '01a15c1e-6729-701b-9e90-d7d8e48a862e/01a15c1e-682f-711f-b032-b42874cfc604';
const SECRET = ['fake', 'secret', 'access', 'key', '0123456789'].join('-');

const objects = new Map<string, Buffer>();
const seen: {
  method?: string | undefined;
  url?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
}[] = [];
let server: Server;
let storage: S3FileStorage;
let mode: 'ok' | 'down' = 'ok';

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      if (mode === 'down') {
        res.writeHead(500);
        return res.end(`<Error>bad key ${SECRET}</Error>`);
      }
      const path = req.url ?? '';
      if (req.method === 'PUT') {
        objects.set(path, Buffer.concat(chunks));
        res.writeHead(200);
        return res.end();
      }
      const found = objects.get(path);
      res.writeHead(found ? 200 : 404);
      res.end(found ?? '<Error>NoSuchKey</Error>');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  storage = new S3FileStorage({
    bucket: 'hr-files',
    region: 'ap-south-1',
    accessKeyId: 'AKIAFAKEFAKEFAKE0000',
    secretAccessKey: SECRET,
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  });
});

afterAll(() => {
  server.close();
});

describe('S3FileStorage', () => {
  it('stores and returns the same bytes, with signed requests that never carry the secret', async () => {
    const data = Buffer.from([0, 1, 2, 250, 251, 252, 255]);
    await storage.put(KEY, data);
    expect(await storage.get(KEY)).toEqual(data);

    const put = seen.find((s) => s.method === 'PUT')!;
    expect(put.url).toBe(`/hr-files/${KEY}`);
    const auth = String(put.headers.authorization);
    expect(auth).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAFAKEFAKEFAKE0000\/\d{8}\/ap-south-1\/s3\/aws4_request, SignedHeaders=.*x-amz-content-sha256/,
    );
    expect(auth).not.toContain(SECRET);
    expect(put.headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports a missing file as an error', async () => {
    await expect(storage.get(KEY.replace('01a15c1e-6729', '01a15c1e-0000'))).rejects.toThrow(/404/);
  });

  it('refuses keys that are not generated ids, before any request', async () => {
    const before = seen.length;
    await expect(storage.get('../../etc/passwd')).rejects.toThrow('Invalid storage key');
    await expect(storage.put('a/b', new Uint8Array())).rejects.toThrow('Invalid storage key');
    expect(seen).toHaveLength(before);
  });

  it('does not leak credentials or the service’s reply in errors', async () => {
    mode = 'down';
    try {
      const error = (await storage.put(KEY, new Uint8Array([1])).catch((e: unknown) => e)) as Error;
      expect(error.message).toBe('Storage refused the file (500)');
      expect(error.message).not.toContain(SECRET);
    } finally {
      mode = 'ok';
    }
  });
});
