import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  installLicenceSchema,
  issuedLicenceNotesSchema,
  recordIssuedLicenceSchema,
  revokeIssuedLicenceSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { CurrentAuth, RequirePlatformAdmin, RequireRecentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { LicenceService } from '../entitlements/licence.service.js';
import { LicenceRegisterService } from './licence-register.service.js';

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

/** The register of licences issued to in-house customers, with renewal reminders. */
@ApiTags('platform')
@RequirePlatformAdmin()
@Controller('v1/platform/licence-register')
export class PlatformLicenceRegisterController {
  constructor(private readonly register: LicenceRegisterService) {}

  @Get()
  @ApiOperation({ summary: 'Issued licences and subscriptions or trials about to end' })
  overview(@CurrentAuth() auth: AuthContext) {
    return this.register.overview(auth);
  }

  @Post()
  @RequireRecentAuth()
  @ApiOperation({ summary: 'Record a licence that was issued to a customer' })
  record(
    @Body({ schema: recordIssuedLicenceSchema }) body: z.output<typeof recordIssuedLicenceSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.register.record(auth, body, requestMeta(req));
  }

  @Get(':id/licence')
  @ApiOperation({ summary: 'The licence text, to send to the customer again' })
  token(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext) {
    return this.register.token(auth, id);
  }

  @Post(':id/revoke')
  @RequireRecentAuth()
  @ApiOperation({ summary: 'Mark a licence as revoked (it stays in the register)' })
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: revokeIssuedLicenceSchema }) body: z.output<typeof revokeIssuedLicenceSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.register.revoke(auth, id, body.reason, requestMeta(req));
  }

  @Patch(':id/notes')
  @ApiOperation({ summary: 'Change the notes on a licence' })
  notes(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: issuedLicenceNotesSchema }) body: z.output<typeof issuedLicenceNotesSchema>,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.register.setNotes(auth, id, body.notes);
  }
}
