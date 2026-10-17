import { MulterModule } from '@nestjs/platform-express';
import type { ApiEnv } from '../config/env.js';
import { API_ENV } from '../infra/tokens.js';

/** Multipart uploads for a module's controllers, held in memory (small, and encrypted before storage). */
export function uploadsModule() {
  return MulterModule.registerAsync({
    inject: [API_ENV],
    useFactory: (env: ApiEnv) => ({
      limits: {
        fileSize: env.DOCUMENT_MAX_UPLOAD_MB * 1024 * 1024,
        files: 1,
        fields: 20,
        fieldSize: 8 * 1024,
      },
    }),
  });
}
