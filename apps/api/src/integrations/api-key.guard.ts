import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '@smart-hr/shared';
import type { ApiKeyScope } from '@smart-hr/validation';
import type { Request } from 'express';
import { ApiKeysService, type VerifiedKey } from './api-keys.service.js';

const SCOPE_META = 'api-key:scope';

/** Marks a route as readable with an API key that has this permission. */
export const RequireApiScope = (scope: ApiKeyScope) => SetMetadata(SCOPE_META, scope);

export type ApiKeyRequest = Request & { apiKey?: VerifiedKey };

/**
 * Authenticates a request made with `Authorization: Bearer shr_…`. Routes using it also carry @Public(), which
 * only skips the sign-in-session check; this guard is the only way in. Every failure is the same 401.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly keys: ApiKeysService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ApiKeyRequest>();
    const header = req.headers.authorization ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const key = presented ? await this.keys.verify(presented) : null;
    if (!key) throw new AppError('INVALID_API_KEY', 'The API key is missing, wrong, expired or revoked', 401);
    const scope = this.reflector.getAllAndOverride<ApiKeyScope | undefined>(SCOPE_META, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (scope && !key.scopes.includes(scope))
      throw new AppError('API_KEY_SCOPE', 'This API key isn’t allowed to do that', 403);
    req.apiKey = key;
    return true;
  }
}
