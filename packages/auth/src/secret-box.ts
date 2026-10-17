import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for small secrets stored in the database (TOTP seeds).
 * Format: `v1.<keyId>.<iv>.<ciphertext>.<tag>` (base64url parts). The key id allows key rotation:
 * decryption looks the key up by id, encryption always uses the current key.
 * `associatedData` binds a ciphertext to its owner (e.g. the user id), so it cannot be copied to another row.
 */
export class SecretBox {
  private readonly keys: Map<string, Buffer>;

  constructor(
    keys: Record<string, string>,
    private readonly currentKeyId: string,
  ) {
    this.keys = new Map(
      Object.entries(keys).map(([id, base64]) => {
        const key = Buffer.from(base64, 'base64');
        if (key.length !== 32) throw new Error(`Encryption key "${id}" must be 32 bytes (base64-encoded)`);
        if (!/^[a-z0-9-]{1,32}$/.test(id)) throw new Error('Encryption key ids must be short slugs');
        return [id, key] as const;
      }),
    );
    if (!this.keys.has(currentKeyId))
      throw new Error(`Current encryption key "${currentKeyId}" is not configured`);
  }

  encrypt(plaintext: string, associatedData: string): string {
    const key = this.keys.get(this.currentKeyId)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      'v1',
      this.currentKeyId,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      tag.toString('base64url'),
    ].join('.');
  }

  /** Throws if the value was tampered with, encrypted for different associated data, or uses an unknown key. */
  decrypt(sealed: string, associatedData: string): string {
    const [version, keyId, iv, ciphertext, tag] = sealed.split('.');
    if (version !== 'v1' || !keyId || !iv || !ciphertext || !tag) throw new Error('Malformed sealed secret');
    const key = this.keys.get(keyId);
    if (!key) throw new Error('Unknown encryption key');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString(
      'utf8',
    );
  }

  /**
   * Binary form for files: `SHB1 | keyId length | keyId | iv | tag | ciphertext`. Same key ring and the same
   * binding to `associatedData`; the key id is stored inside so rotated keys still open older files.
   */
  sealBytes(plaintext: Uint8Array, associatedData: string): Buffer {
    const key = this.keys.get(this.currentKeyId)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const id = Buffer.from(this.currentKeyId, 'utf8');
    return Buffer.concat([BYTES_MAGIC, Buffer.from([id.length]), id, iv, cipher.getAuthTag(), ciphertext]);
  }

  /** The key id a sealed file was encrypted with (for re-encryption after a key rotation). */
  static keyIdOf(sealed: Uint8Array): string {
    const buf = Buffer.from(sealed);
    if (buf.length < 5 || !buf.subarray(0, 4).equals(BYTES_MAGIC)) throw new Error('Malformed sealed file');
    return buf.subarray(5, 5 + buf[4]!).toString('utf8');
  }

  /** Throws if the file was tampered with, belongs to different associated data, or uses an unknown key. */
  openBytes(sealed: Uint8Array, associatedData: string): Buffer {
    const buf = Buffer.from(sealed);
    const keyId = SecretBox.keyIdOf(buf);
    const start = 5 + buf[4]!;
    if (buf.length < start + 28) throw new Error('Malformed sealed file');
    const key = this.keys.get(keyId);
    if (!key) throw new Error('Unknown encryption key');
    const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(start, start + 12));
    decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    decipher.setAuthTag(buf.subarray(start + 12, start + 28));
    return Buffer.concat([decipher.update(buf.subarray(start + 28)), decipher.final()]);
  }
}

const BYTES_MAGIC = Buffer.from('SHB1', 'ascii');
