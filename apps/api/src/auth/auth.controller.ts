import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaVerifySchema,
  reauthenticateSchema,
  resetPasswordSchema,
  switchTenantSchema,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type MfaVerifyInput,
  type ReauthenticateInput,
  type ResetPasswordInput,
  type SwitchTenantInput,
} from '@smart-hr/validation';
import type { Response } from 'express';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import type { ApiEnv } from '../config/env.js';
import { API_ENV } from '../infra/tokens.js';
import { AllowMfaPending, CurrentAuth, Public } from './auth.decorators.js';
import { AuthService } from './auth.service.js';
import type { AuthContext, SessionView } from './auth.types.js';
import { clearSessionCookies, setSessionCookies } from './cookies.js';
import { SessionService } from './session.service.js';

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(
    @Body({ schema: loginSchema }) body: LoginInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionView> {
    // A new session is always issued; an existing one on this browser is ended (no session fixation).
    if (req.auth) await this.sessions.revoke(req.auth.session.id, 'replaced_by_login');
    const issued = await this.auth.login(body, requestMeta(req));
    setSessionCookies(res, issued, this.env);
    const resolved = await this.sessions.resolve(issued.token);
    return this.auth.view(issued.session, resolved!.user);
  }

  @AllowMfaPending()
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete sign-in with an authenticator or recovery code' })
  async verifyMfa(
    @Body({ schema: mfaVerifySchema }) body: MfaVerifyInput,
    @CurrentAuth() current: AuthContext,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionView> {
    const issued = await this.auth.verifyMfa(current, body, requestMeta(req));
    setSessionCookies(res, issued, this.env);
    return this.auth.view(issued.session, current.user);
  }

  @AllowMfaPending()
  @Get('session')
  @ApiOperation({ summary: 'The current session, user and organisations' })
  async session(@CurrentAuth() current: AuthContext): Promise<SessionView> {
    return this.auth.view(current.session, current.user);
  }

  @AllowMfaPending()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End this session' })
  async logout(
    @CurrentAuth() current: AuthContext,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(current, requestMeta(req));
    clearSessionCookies(res, this.env);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End every session of this user, including this one' })
  async logoutAll(
    @CurrentAuth() current: AuthContext,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logoutAll(current, requestMeta(req));
    clearSessionCookies(res, this.env);
  }

  @Post('tenant')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Switch the active organisation' })
  async switchTenant(
    @Body({ schema: switchTenantSchema }) body: SwitchTenantInput,
    @CurrentAuth() current: AuthContext,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionView> {
    const issued = await this.auth.switchTenant(current, body.tenantId, requestMeta(req));
    setSessionCookies(res, issued, this.env);
    return this.auth.view(issued.session, current.user);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Email a password reset link if the account exists' })
  async forgotPassword(
    @Body({ schema: forgotPasswordSchema }) body: ForgotPasswordInput,
    @Req() req: AppRequest,
  ): Promise<{ message: string }> {
    await this.auth.forgotPassword(body.email, requestMeta(req));
    return { message: 'If an account exists for that email, a reset link is on its way.' };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a new password with a reset link token' })
  async resetPassword(
    @Body({ schema: resetPasswordSchema }) body: ResetPasswordInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.resetPassword(body, requestMeta(req));
    // Every session was revoked, including any on this browser.
    clearSessionCookies(res, this.env);
  }

  @Post('password/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change password; signs out every other session' })
  async changePassword(
    @Body({ schema: changePasswordSchema }) body: ChangePasswordInput,
    @CurrentAuth() current: AuthContext,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const issued = await this.auth.changePassword(current, body, requestMeta(req));
    setSessionCookies(res, issued, this.env);
  }

  @Post('reauthenticate/code')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Email a one-time code to confirm a sensitive change' })
  async sendReauthenticationCode(@CurrentAuth() current: AuthContext, @Req() req: AppRequest): Promise<void> {
    await this.auth.sendReauthenticationCode(current, requestMeta(req));
  }

  @Post('reauthenticate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Confirm identity before a sensitive change' })
  async reauthenticate(
    @Body({ schema: reauthenticateSchema }) body: ReauthenticateInput,
    @CurrentAuth() current: AuthContext,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.auth.reauthenticate(current, body, requestMeta(req));
  }
}
