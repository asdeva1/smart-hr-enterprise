import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  appraisalListQuerySchema,
  colleagueFeedbackSchema,
  cycleListQuerySchema,
  employeeSearchSchema,
  goalSchema,
  managerReviewSchema,
  reviewCycleSchema,
  selfReviewSchema,
  updateGoalSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequireFeature, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { PerformanceService } from './performance.service.js';

const id = () => new ParseUUIDPipe();

/**
 * Anyone with an employee record can work on their own goals and review and give feedback; what they can see
 * beyond that depends on `performance.view` and `performance.manage`, checked per company in the service.
 */
@ApiTags('performance')
@RequireFeature('performance')
@Controller('v1/performance')
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get('cycles')
  cycles(
    @Query({ schema: cycleListQuerySchema }) q: z.output<typeof cycleListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.performance.listCycles(tenant, auth, q.companyId);
  }

  @Post('cycles')
  @RequirePermission('performance.manage')
  createCycle(
    @Body({ schema: reviewCycleSchema }) body: z.output<typeof reviewCycleSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.performance.createCycle(tenant, auth, body, requestMeta(req));
  }

  @Post('cycles/:id/open')
  openCycle(
    @Param('id', id()) cycleId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.performance.openCycle(tenant, auth, cycleId, requestMeta(req));
  }

  @Post('cycles/:id/close')
  closeCycle(
    @Param('id', id()) cycleId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.performance.closeCycle(tenant, auth, cycleId, requestMeta(req));
  }

  @Get('cycles/:id/appraisals')
  appraisals(
    @Param('id', id()) cycleId: string,
    @Query({ schema: appraisalListQuerySchema }) q: z.output<typeof appraisalListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.performance.listAppraisals(tenant, auth, cycleId, q);
  }

  @Get('mine')
  mine(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.performance.mine(tenant, auth);
  }

  @Get('to-review')
  toReview(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.performance.toReview(tenant, auth);
  }

  @Get('people')
  people(
    @Query({ schema: employeeSearchSchema }) q: z.output<typeof employeeSearchSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.performance.people(tenant, auth, q.search);
  }

  @Get('feedback')
  feedback(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.performance.feedback(tenant, auth);
  }

  @Post('feedback')
  giveFeedback(
    @Body({ schema: colleagueFeedbackSchema }) body: z.output<typeof colleagueFeedbackSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.performance.giveFeedback(tenant, auth, body);
  }

  @Post('goals')
  createGoal(
    @Body({ schema: goalSchema }) body: z.output<typeof goalSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.performance.createGoal(tenant, auth, body);
  }

  @Patch('goals/:id')
  updateGoal(
    @Param('id', id()) goalId: string,
    @Body({ schema: updateGoalSchema }) body: z.output<typeof updateGoalSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.performance.updateGoal(tenant, auth, goalId, body);
  }

  @Delete('goals/:id')
  removeGoal(
    @Param('id', id()) goalId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.performance.removeGoal(tenant, auth, goalId);
  }

  @Get('appraisals/:id')
  appraisal(
    @Param('id', id()) appraisalId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.performance.getAppraisal(tenant, auth, appraisalId);
  }

  @Post('appraisals/:id/self')
  selfReview(
    @Param('id', id()) appraisalId: string,
    @Body({ schema: selfReviewSchema }) body: z.output<typeof selfReviewSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.performance.selfReview(tenant, auth, appraisalId, body, requestMeta(req));
  }

  @Post('appraisals/:id/review')
  review(
    @Param('id', id()) appraisalId: string,
    @Body({ schema: managerReviewSchema }) body: z.output<typeof managerReviewSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.performance.managerReview(tenant, auth, appraisalId, body, requestMeta(req));
  }

  @Post('appraisals/:id/acknowledge')
  acknowledge(
    @Param('id', id()) appraisalId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.performance.acknowledge(tenant, auth, appraisalId, requestMeta(req));
  }
}
