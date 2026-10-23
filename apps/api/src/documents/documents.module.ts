import { Module, type OnModuleInit } from '@nestjs/common';
import type { ApiEnv } from '../config/env.js';
import { API_ENV } from '../infra/tokens.js';
import { TenantExportService } from '../tenant/export.service.js';
import { DocumentsController, SignaturesController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { FilesService } from './files.service.js';
import { SignaturesService } from './signatures.service.js';
import { FILE_STORAGE, LocalFileStorage, S3FileStorage } from './storage.js';
import { uploadsModule } from './uploads.js';

@Module({
  imports: [uploadsModule()],
  controllers: [DocumentsController, SignaturesController],
  providers: [
    {
      provide: FILE_STORAGE,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) =>
        env.STORAGE_DRIVER === 's3'
          ? new S3FileStorage({
              bucket: env.S3_BUCKET!,
              region: env.S3_REGION!,
              accessKeyId: env.S3_ACCESS_KEY_ID!,
              secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
              sessionToken: env.S3_SESSION_TOKEN,
              endpoint: env.S3_ENDPOINT,
            })
          : new LocalFileStorage(env.STORAGE_LOCAL_DIR),
    },
    FilesService,
    DocumentsService,
    SignaturesService,
  ],
  exports: [FilesService, DocumentsService, FILE_STORAGE],
})
export class DocumentsModule implements OnModuleInit {
  constructor(private readonly exporter: TenantExportService) {}

  /** Document records are part of the organisation's data export (the files themselves are listed by hash). */
  onModuleInit(): void {
    this.exporter.register('storedFiles', (tx) =>
      tx.storedFile.findMany({
        orderBy: { createdAt: 'asc' },
        select: { id: true, fileName: true, mimeType: true, sizeBytes: true, sha256: true, createdAt: true },
      }),
    );
    this.exporter.register('employeeDocuments', (tx) =>
      tx.employeeDocument.findMany({ orderBy: [{ employeeId: 'asc' }, { createdAt: 'asc' }] }),
    );
    this.exporter.register('letterTemplates', (tx) =>
      tx.letterTemplate.findMany({ orderBy: { name: 'asc' } }),
    );
    this.exporter.register('signatureRequests', (tx) =>
      tx.signatureRequest.findMany({ orderBy: { createdAt: 'asc' }, include: { signers: true } }),
    );
  }
}
