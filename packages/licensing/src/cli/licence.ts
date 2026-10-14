#!/usr/bin/env node
/**
 * Licence tooling for Smartclues staff. Installations never need this.
 *
 *   smart-hr-licence keygen --key-id k2026 --out ./k2026.pem   writes a new private key (0600), prints the public key
 *   smart-hr-licence issue --key ./k2026.pem --payload ./customer.json   prints a signed licence
 *   smart-hr-licence inspect --licence ./customer.licence --public-keys "k2026:…"   verifies and prints the payload
 *
 * The private key is only ever read from or written to a file; it is never printed.
 */
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  exportPublicKey,
  licencePayloadSchema,
  loadPrivateKey,
  parsePublicKeys,
  signLicence,
  verifyLicence,
} from '../licence.js';

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    'key-id': { type: 'string' },
    out: { type: 'string' },
    key: { type: 'string' },
    payload: { type: 'string' },
    licence: { type: 'string' },
    'public-keys': { type: 'string' },
  },
});

function required(name: keyof typeof values): string {
  const value = values[name];
  if (typeof value !== 'string' || !value) {
    process.stderr.write(`--${name} is required\n`);
    process.exit(2);
  }
  return value;
}

switch (command) {
  case 'keygen': {
    const keyId = required('key-id');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    // flag "wx" refuses to overwrite an existing key file.
    writeFileSync(required('out'), privateKey.export({ format: 'pem', type: 'pkcs8' }), {
      mode: 0o600,
      flag: 'wx',
    });
    process.stdout.write(
      `Public key (add to LICENCE_PUBLIC_KEYS):\n${keyId}:${exportPublicKey(publicKey)}\n`,
    );
    break;
  }
  case 'issue': {
    const key = loadPrivateKey(readFileSync(required('key'), 'utf8'));
    const draft = JSON.parse(readFileSync(required('payload'), 'utf8')) as Record<string, unknown>;
    const payload = licencePayloadSchema.parse({
      v: 1,
      licenceId: randomUUID(),
      issuedAt: new Date().toISOString(),
      ...draft,
    });
    process.stdout.write(`${signLicence(payload, key)}\n`);
    break;
  }
  case 'inspect': {
    const result = verifyLicence(
      readFileSync(required('licence'), 'utf8'),
      parsePublicKeys(required('public-keys')),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.ok ? 0 : 1);
    break;
  }
  default:
    process.stderr.write('Usage: smart-hr-licence keygen|issue|inspect …\n');
    process.exit(2);
}
