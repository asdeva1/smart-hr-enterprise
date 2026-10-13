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
}
