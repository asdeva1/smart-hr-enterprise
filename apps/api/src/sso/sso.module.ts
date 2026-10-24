import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OidcService } from './oidc.service.js';
import { SsoAdminController, SsoLoginController } from './sso.controller.js';
import { SsoService } from './sso.service.js';

@Module({
  imports: [AuthModule],
  controllers: [SsoAdminController, SsoLoginController],
  providers: [OidcService, SsoService],
})
export class SsoModule {}
