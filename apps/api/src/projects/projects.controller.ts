import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  approveTimeSchema,
  employeeSearchSchema,
  projectListQuerySchema,
  projectMembersSchema,
  projectSchema,
  timeEntrySchema,
  timeRangeSchema,
  updateProjectSchema,
  updateTimeEntrySchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequireFeature, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { ProjectsService } from './projects.service.js';

const id = () => new ParseUUIDPipe();

/** Static routes come before `:id` so "time" and "mine" are never read as a project. */
@ApiTags('projects')
@RequireFeature('projects')
@Controller('v1/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(
    @Query({ schema: projectListQuerySchema }) q: z.output<typeof projectListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.projects.list(tenant, auth, q);
  }

  @Post()
  @RequirePermission('projects.manage')
  create(
    @Body({ schema: projectSchema }) body: z.output<typeof projectSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.projects.create(tenant, auth, body, requestMeta(req));
  }

  @Get('mine')
  mine(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.projects.mine(tenant, auth);
  }

  @Get('people')
  @RequirePermission('projects.manage')
  people(
    @Query({ schema: employeeSearchSchema }) q: z.output<typeof employeeSearchSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.projects.people(tenant, auth, q.search);
  }

  @Get('time')
  myTime(
    @Query({ schema: timeRangeSchema }) q: z.output<typeof timeRangeSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.projects.myTime(tenant, auth, q);
  }

  @Post('time')
  logTime(
    @Body({ schema: timeEntrySchema }) body: z.output<typeof timeEntrySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.projects.logTime(tenant, auth, body, requestMeta(req));
  }

  @Post('time/approve')
  approve(
    @Body({ schema: approveTimeSchema }) body: z.output<typeof approveTimeSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.projects.approve(tenant, auth, body, requestMeta(req));
  }

  @Patch('time/:entryId')
  updateTime(
    @Param('entryId', id()) entryId: string,
    @Body({ schema: updateTimeEntrySchema }) body: z.output<typeof updateTimeEntrySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.projects.updateTime(tenant, auth, entryId, body, requestMeta(req));
  }

  @Delete('time/:entryId')
  deleteTime(
    @Param('entryId', id()) entryId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.projects.deleteTime(tenant, auth, entryId, requestMeta(req));
  }

  @Get(':id')
  detail(
    @Param('id', id()) projectId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.projects.detail(tenant, auth, projectId);
  }

  @Patch(':id')
  @RequirePermission('projects.manage')
  update(
    @Param('id', id()) projectId: string,
    @Body({ schema: updateProjectSchema }) body: z.output<typeof updateProjectSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.projects.update(tenant, auth, projectId, body, requestMeta(req));
  }

  @Put(':id/members')
  @RequirePermission('projects.manage')
  setMembers(
    @Param('id', id()) projectId: string,
    @Body({ schema: projectMembersSchema }) body: z.output<typeof projectMembersSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.projects.setMembers(tenant, auth, projectId, body, requestMeta(req));
  }

  @Get(':id/time')
  projectTime(
    @Param('id', id()) projectId: string,
    @Query({ schema: timeRangeSchema }) q: z.output<typeof timeRangeSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.projects.projectTime(tenant, auth, projectId, q);
  }
}
