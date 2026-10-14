import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  CurrentAuth,
  CurrentTenant,
  RequireRecentAuth,
  RequireTenantAdmin,
} from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { TenantExportService } from './export.service.js';

@ApiTags('organisation')
@Controller('v1/tenant/export')
export class TenantExportController {
  constructor(private readonly exporter: TenantExportService) {}

  /** A GET, so it also works while an organisation is offboarding (read-only). */
  @Get()
  @RequireTenantAdmin()
  @RequireRecentAuth()
  @ApiOperation({
    summary: 'Download all of the organisation’s data as JSON (owners; needs recent password entry)',
  })
  async export(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const body = await this.exporter.export(tenant, auth, requestMeta(req));
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="smart-hr-export-${day}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    return body;
  }
}
