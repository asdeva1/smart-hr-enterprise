import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createLookupValueSchema,
  lookupListQuerySchema,
  updateLookupValueSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequirePermission, RequireTenant } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { MasterDataService } from './master-data.service.js';

@ApiTags('master data')
@RequireTenant()
@Controller('v1/master-data')
export class MasterDataController {
  constructor(private readonly masterData: MasterDataService) {}

  @Get()
  @ApiOperation({ summary: 'The reference lists, with how many values each has' })
  catalogue(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.masterData.catalogue(tenant, auth);
  }

  @Get(':list')
  @ApiOperation({ summary: 'Values in one list (active only unless includeArchived=true)' })
  values(
    @Param('list') list: string,
    @Query({ schema: lookupListQuerySchema }) query: z.output<typeof lookupListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.masterData.values(tenant, auth, list, query.includeArchived);
  }

  @Post(':list')
  @RequirePermission('master_data.manage')
  @ApiOperation({ summary: 'Add a value (master_data.manage)' })
  create(
    @Param('list') list: string,
    @Body({ schema: createLookupValueSchema }) body: z.output<typeof createLookupValueSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.masterData.create(tenant, auth, list, body, requestMeta(req));
  }

  @Patch(':list/:id')
  @RequirePermission('master_data.manage')
  @ApiOperation({ summary: 'Rename, reorder, archive or restore a value (master_data.manage)' })
  update(
    @Param('list') list: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: updateLookupValueSchema }) body: z.output<typeof updateLookupValueSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.masterData.update(tenant, auth, list, id, body, requestMeta(req));
  }

  @Post(':list/suggestions')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('master_data.manage')
  @ApiOperation({ summary: 'Add the suggested values this list doesn’t have yet' })
  addSuggestions(
    @Param('list') list: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.masterData.addSuggestions(tenant, auth, list, requestMeta(req));
  }
}
