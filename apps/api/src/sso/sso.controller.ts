import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Put, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  saveSsoConnectionSchema,
  ssoDiscoverQuerySchema,
  ssoStartQuerySchema,
  type SaveSsoConnectionInput,
} from '@smart-hr/validation';
import type { Response } from 'express';
import { CurrentAuth, CurrentTenant, Public, RequireFeature, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { setSessionCookies } from '../auth/cookies.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import type { ApiEnv } from '../config/env.js';
import { API_ENV } from '../infra/tokens.js';
import { SsoLoginError, SsoService } from './sso.service.js';

const ATTEMPT_COOKIE = 'shr_sso';

/** Setting up single sign-on: administrators only, on plans that include it. */
@ApiTags('sso')
@RequireFeature('sso')
@RequirePermission('security.manage')
@Controller('v1/sso/connection')
export class SsoAdminController {
  constructor(private readonly sso: SsoService) {}

  @Get()
  get(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.sso.get(tenant, auth);
  }

  @Put()
  save(
    @Body({ schema: saveSsoConnectionSchema }) body: SaveSsoConnectionInput,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.sso.save(tenant, auth, body, requestMeta(req));
  }
}

/** The sign-in side. Public, because nobody has a session yet. */
@ApiTags('sso')
@Public()
@Controller('v1/sso')
export class SsoLoginController {
  constructor(
    private readonly sso: SsoService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private cookieOptions() {
    return {
      path: '/v1/sso',
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.env.AUTH_COOKIE_SECURE,
      ...(this.env.AUTH_COOKIE_DOMAIN ? { domain: this.env.AUTH_COOKIE_DOMAIN } : {}),
    };
  }

  private failure(res: Response, code: string) {
    res.clearCookie(ATTEMPT_COOKIE, this.cookieOptions());
    res.redirect(302, new URL(`/login?sso_error=${encodeURIComponent(code)}`, this.env.APP_PUBLIC_URL).toString());
  }

  @Get('discover')
  discover(@Query() query: Record<string, unknown>, @Req() req: AppRequest) {
    const parsed = ssoDiscoverQuerySchema.safeParse(query);
    if (!parsed.success) return { sso: false };
    return this.sso.discover(parsed.data.email, requestMeta(req));
  }

  @Get('start')
  async start(@Query() query: Record<string, unknown>, @Req() req: AppRequest, @Res() res: Response) {
    const parsed = ssoStartQuerySchema.safeParse(query);
    if (!parsed.success) return this.failure(res, 'unavailable');
    try {
      const started = await this.sso.start(parsed.data.email, parsed.data.next, requestMeta(req));
      res.cookie(ATTEMPT_COOKIE, started.cookie, { ...this.cookieOptions(), maxAge: started.maxAgeMs });
      return res.redirect(302, started.url);
    } catch (error) {
      return this.failure(res, error instanceof SsoLoginError ? error.code : 'provider');
    }
  }

  @Get('callback')
  @HttpCode(HttpStatus.FOUND)
  async callback(@Query() query: Record<string, unknown>, @Req() req: AppRequest, @Res() res: Response) {
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    try {
      const { issued, next } = await this.sso.complete(
        { code: str(query.code), state: str(query.state), error: str(query.error) },
        cookies?.[ATTEMPT_COOKIE],
        requestMeta(req),
      );
      res.clearCookie(ATTEMPT_COOKIE, this.cookieOptions());
      setSessionCookies(res, issued, this.env);
      return res.redirect(302, new URL(next, this.env.APP_PUBLIC_URL).toString());
    } catch (error) {
      return this.failure(res, error instanceof SsoLoginError ? error.code : 'provider');
    }
  }
}
