import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { Logger } from 'pino';
import { AccessModule } from './access/access.module.js';
import { ApprovalsModule } from './approvals/approvals.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AttendanceModule } from './attendance/attendance.module.js';
import { LeaveModule } from './leave/leave.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { RecruitmentModule } from './recruitment/recruitment.module.js';
import { EmployeesModule } from './employees/employees.module.js';
import { EntitlementsModule } from './entitlements/entitlements.module.js';
import type { ApiEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { IdentityModule } from './identity/identity.module.js';
import { InfraModule } from './infra/infra.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { MasterDataModule } from './master-data/master-data.module.js';
import { OrgModule } from './org/org.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { RbacModule } from './rbac/rbac.module.js';
import { SignupModule } from './signup/signup.module.js';
import { TenantModule } from './tenant/tenant.module.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Reuses a well-formed incoming X-Request-Id (from the load balancer) or mints one, and echoes it back. */
export function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', id);
  return id;
}

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv, logger: Logger, extraModules: (Type | DynamicModule)[] = []): DynamicModule {
    return {
      module: AppModule,
      imports: [
        InfraModule.forRoot(env),
        LoggerModule.forRoot({
          pinoHttp: {
            logger,
            genReqId: requestId,
            autoLogging: { ignore: (req) => req.url?.startsWith('/health/') ?? false },
          },
        }),
        AuditModule,
        NotificationsModule,
        RbacModule,
        EntitlementsModule,
        IdentityModule,
        AuthModule,
        TenantModule,
        OrgModule,
        AccessModule,
        ApprovalsModule,
        MasterDataModule,
        EmployeesModule,
        AttendanceModule,
        LeaveModule,
        DocumentsModule,
        RecruitmentModule,
        PlatformModule,
        SignupModule,
        ...extraModules,
      ],
      controllers: [HealthController],
    };
  }
}
