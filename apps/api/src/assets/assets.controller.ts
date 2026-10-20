import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  assetListQuerySchema,
  assetSchema,
  assignAssetSchema,
  retireAssetSchema,
  returnAssetSchema,
  updateAssetSchema,
} from '@smart-hr/validation';
import { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequireFeature, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { AssetsService } from './assets.service.js';

const id = () => new ParseUUIDPipe();
const peopleQuery = z.object({ search: z.string().trim().max(100).default('') });

@ApiTags('assets')
@RequireFeature('assets')
@Controller('v1/assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @RequirePermission('assets.view')
  list(
    @Query({ schema: assetListQuerySchema }) q: z.output<typeof assetListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.assets.list(tenant, auth, q);
  }

  /** What the signed-in employee has been given; open to everyone with an employee record. */
  @Get('mine')
  mine(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.assets.mine(tenant, auth);
  }

  @Get('people')
  @RequirePermission('assets.manage')
  people(
    @Query({ schema: peopleQuery }) q: z.output<typeof peopleQuery>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.assets.people(tenant, auth, q.search);
  }

  @Post()
  @RequirePermission('assets.manage')
  create(
    @Body({ schema: assetSchema }) body: z.output<typeof assetSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.assets.create(tenant, auth, body, requestMeta(req));
  }

  @Get(':id')
  @RequirePermission('assets.view')
  get(
    @Param('id', id()) assetId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.assets.get(tenant, auth, assetId);
  }

  @Patch(':id')
  @RequirePermission('assets.manage')
  update(
    @Param('id', id()) assetId: string,
    @Body({ schema: updateAssetSchema }) body: z.output<typeof updateAssetSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.assets.update(tenant, auth, assetId, body, requestMeta(req));
  }

  @Post(':id/assign')
  @RequirePermission('assets.manage')
  assign(
    @Param('id', id()) assetId: string,
    @Body({ schema: assignAssetSchema }) body: z.output<typeof assignAssetSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.assets.assign(tenant, auth, assetId, body, requestMeta(req));
  }

  @Post(':id/return')
  @RequirePermission('assets.manage')
  giveBack(
    @Param('id', id()) assetId: string,
    @Body({ schema: returnAssetSchema }) body: z.output<typeof returnAssetSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.assets.giveBack(tenant, auth, assetId, body, requestMeta(req));
  }

  @Post(':id/retire')
  @RequirePermission('assets.manage')
  retire(
    @Param('id', id()) assetId: string,
    @Body({ schema: retireAssetSchema }) body: z.output<typeof retireAssetSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.assets.retire(tenant, auth, assetId, body, requestMeta(req));
  }
}
