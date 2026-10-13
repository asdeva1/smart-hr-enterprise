import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { confirmTotpSchema, type ConfirmTotpInput } from '@smart-hr/validation';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { CurrentAuth, RequireRecentAuth } from './auth.decorators.js';
import { AuthService } from './auth.service.js';
import type { AuthContext } from './auth.types.js';

@ApiTags('account security')
@Controller('v1/auth')
export class AccountSecurityController {
  constructor(private readonly auth: AuthService) {}

  @Get('sessions')
  @ApiOperation({ summary: 'This user’s active sessions' })
  sessions(@CurrentAuth() current: AuthContext) {
    return this.auth.listSessions(current);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out one of this user’s sessions' })
  async revokeSession(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAuth() current: AuthContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.auth.revokeSession(current, id, requestMeta(req));
  }

  @Get('security-events')
  @ApiOperation({ summary: 'Recent sign-in and security activity for this user' })
  securityEvents(@CurrentAuth() current: AuthContext) {
    return this.auth.recentSecurityEvents(current);
  }

  @RequireRecentAuth()
  @Post('mfa/totp/setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start authenticator-app enrolment' })
  startTotp(@CurrentAuth() current: AuthContext, @Req() req: AppRequest) {
    return this.auth.startTotpEnrolment(current, requestMeta(req));
  }

  @RequireRecentAuth()
  @Post('mfa/totp/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finish enrolment with a code; returns one-time recovery codes' })
  async confirmTotp(
    @Body({ schema: confirmTotpSchema }) body: ConfirmTotpInput,
    @CurrentAuth() current: AuthContext,
    @Req() req: AppRequest,
  ): Promise<{ recoveryCodes: string[] }> {
    return { recoveryCodes: await this.auth.confirmTotpEnrolment(current, body.code, requestMeta(req)) };
  }

  @RequireRecentAuth()
  @Post('mfa/recovery-codes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replace recovery codes; old ones stop working' })
  async regenerateRecoveryCodes(
    @CurrentAuth() current: AuthContext,
    @Req() req: AppRequest,
  ): Promise<{ recoveryCodes: string[] }> {
    return { recoveryCodes: await this.auth.regenerateRecoveryCodes(current, requestMeta(req)) };
  }

  @RequireRecentAuth()
  @Delete('mfa/totp')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Turn off two-step verification' })
  async disableTotp(@CurrentAuth() current: AuthContext, @Req() req: AppRequest): Promise<void> {
    await this.auth.disableTotp(current, requestMeta(req));
  }
}
