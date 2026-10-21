import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequireTenant } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { SearchService } from './search.service.js';

const searchQuerySchema = z.object({ q: z.string().trim().max(100).default('') });

@ApiTags('search')
@Controller('v1/search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @RequireTenant()
  find(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Query({ schema: searchQuerySchema }) query: z.output<typeof searchQuerySchema>,
  ) {
    return this.search.search(tenant, auth, query.q);
  }
}
