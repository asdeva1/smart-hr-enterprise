import { Module, type OnModuleInit } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import type { ApiEnv } from '../config/env.js';
import { API_ENV } from '../infra/tokens.js';
import { TenantExportService } from '../tenant/export.service.js';
import { DocumentsController, SignaturesController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { FilesService } from './files.service.js';
import { SignaturesService } from './signatures.service.js';
import { FILE_STORAGE, LocalFileStorage } from './storage.js';

@Module({
  imports: [
    // Uploads are held in memory (they are small and are encrypted before anything is written).
    MulterModule.registerAsync({
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => ({
        limits: {
          fileSize: env.DOCUMENT_MAX_UPLOAD_MB * 1024 * 1024,
          files: 1,
          fields: 20,
          fieldSize: 8 * 1024,
        },
      }),
    }),
  ],
  controllers: [DocumentsController, SignaturesController],
  providers: [
    {
      provide: FILE_STORAGE,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => new LocalFileStorage(env.STORAGE_LOCAL_DIR),
    },
    FilesService,
    DocumentsService,
    SignaturesService,
  ],
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
