import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { installLicenceSchema } from '@smart-hr/validation';
import type { z } from 'zod';
import { CurrentAuth, RequirePlatformAdmin, RequireRecentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { LicenceService } from '../entitlements/licence.service.js';

/** The installation's licence (in-house deployments). Platform administrators only. */
@ApiTags('platform')
@RequirePlatformAdmin()
@Controller('v1/platform/licence')
export class PlatformLicenceController {
  constructor(private readonly licences: LicenceService) {}

  @Get()
  @ApiOperation({ summary: 'Deployment mode, installation id, current licence and its history' })
  get(@CurrentAuth() auth: AuthContext) {
    return this.licences.overview(auth);
  }

  @Put()
  @RequireRecentAuth()
  @ApiOperation({ summary: 'Install a signed licence (verified offline; replaces the current one)' })
  install(
    @Body({ schema: installLicenceSchema }) body: z.output<typeof installLicenceSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.licences.install(auth, body.licence, requestMeta(req));
  }
}
