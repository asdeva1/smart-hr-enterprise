import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SecretBox } from '@smart-hr/auth';
import type { StoredFile, TenantTransaction } from '@smart-hr/database';
import { AppError } from '@smart-hr/shared';
import type { ApiEnv } from '../config/env.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { API_ENV } from '../infra/tokens.js';
import { FILE_STORAGE, type FileStorage } from './storage.js';

const GB = 1024 ** 3;

export const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/**
 * Stores and reads files. Every file is encrypted with the organisation-data key ring before it leaves the
 * process, bound to its organisation and id, and checked against its SHA-256 when read back. Stored files
 * count towards the plan's storage limit.
 */
@Injectable()
export class FilesService {
  private readonly box: SecretBox;

  constructor(
    @Inject(API_ENV) env: ApiEnv,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly entitlements: EntitlementsService,
  ) {
    this.box = new SecretBox(env.DATA_ENCRYPTION_KEYS, env.DATA_ENCRYPTION_KEY_ID);
    entitlements.registerUsage('storage.gb', async (tx) => {
      const sum = await tx.storedFile.aggregate({ _sum: { sizeBytes: true } });
      return Math.round(((sum._sum.sizeBytes ?? 0) / GB) * 1000) / 1000;
    });
  }

  private aad(tenantId: string, fileId: string) {
    return `stored_file:${tenantId}:${fileId}`;
  }

  /** Encrypts and writes the bytes, then records the file. Call inside the transaction that uses it. */
  async store(
    tx: TenantTransaction,
    tenantId: string,
    input: { data: Uint8Array; fileName: string; mimeType: string; uploadedByUserId: string | null },
  ): Promise<StoredFile> {
    await this.entitlements.assertWithinLimit(tx, 'storage.gb', input.data.length / GB);
    const id = randomUUID();
    const storageKey = `${tenantId}/${id}`;
    const sealed = this.box.sealBytes(input.data, this.aad(tenantId, id));
    // Written before the row: if the transaction then fails, an unreferenced encrypted file is left behind,
    // never a row pointing at nothing.
    await this.storage.put(storageKey, sealed);
    return tx.storedFile.create({
      data: {
        id,
        tenantId,
        storageKey,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.data.length,
        sha256: sha256(input.data),
        encryptionKeyId: SecretBox.keyIdOf(sealed),
        uploadedByUserId: input.uploadedByUserId,
      },
    });
  }

  /** The plaintext, after checking it is exactly what was stored. */
  async read(file: StoredFile): Promise<Buffer> {
    let data: Buffer;
    try {
      data = this.box.openBytes(await this.storage.get(file.storageKey), this.aad(file.tenantId, file.id));
    } catch {
      throw new AppError(
        'FILE_UNAVAILABLE',
        'This file can’t be read. Ask your administrator to check storage.',
        500,
      );
    }
    if (sha256(data) !== file.sha256) {
      throw new AppError(
        'FILE_UNAVAILABLE',
        'This file can’t be read. Ask your administrator to check storage.',
        500,
      );
    }
    return data;
  }
}
