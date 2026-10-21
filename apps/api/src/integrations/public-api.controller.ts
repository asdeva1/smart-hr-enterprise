import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Public } from '../auth/auth.decorators.js';
import { ApiKeyGuard, RequireApiScope, type ApiKeyRequest } from './api-key.guard.js';
import { PublicApiService } from './public-api.service.js';

const employeesQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
  status: z.enum(['CURRENT', 'ALL']).default('CURRENT'),
});

/** Read-only endpoints for outside systems, called with `Authorization: Bearer <API key>`. */
@ApiTags('integrations-api')
@Public()
@UseGuards(ApiKeyGuard)
@Controller('v1/integrations/api')
export class PublicApiController {
  constructor(private readonly api: PublicApiService) {}

  @Get('employees')
  @RequireApiScope('employees.read')
  employees(
    @Req() req: ApiKeyRequest,
    @Query({ schema: employeesQuery }) query: z.output<typeof employeesQuery>,
  ) {
    return this.api.employees(req.apiKey!, query);
  }
}
