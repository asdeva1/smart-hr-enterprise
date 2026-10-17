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
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  applicationSchema,
  completeTaskSchema,
  feedbackSchema,
  hireSchema,
  interviewSchema,
  interviewStatusSchema,
  jobOpeningSchema,
  moveStageSchema,
  offerResponseSchema,
  offerSchema,
  onboardingTemplateSchema,
  openingListQuerySchema,
  openingStatusSchema,
  startOnboardingSchema,
  updateJobOpeningSchema,
} from '@smart-hr/validation';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequireFeature, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import type { UploadedFile as Upload } from '../documents/documents.service.js';
import { contentDisposition } from '../documents/file-types.js';
import { HiringService } from './hiring.service.js';
import { OnboardingService } from './onboarding.service.js';
import { RecruitmentService } from './recruitment.service.js';

const peopleQuerySchema = z.object({ search: z.string().trim().max(100).optional() });
type Id = string;
const id = () => new ParseUUIDPipe();

@ApiTags('recruitment')
@RequireFeature('recruitment')
@Controller('v1/recruitment')
export class RecruitmentController {
  constructor(
    private readonly recruitment: RecruitmentService,
    private readonly hiring: HiringService,
  ) {}

  @Get('openings')
  @ApiOperation({ summary: 'Job openings the member may see' })
  openings(
    @Query({ schema: openingListQuerySchema }) q: z.output<typeof openingListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.recruitment.listOpenings(tenant, auth, q);
  }

  @Post('openings')
  @RequirePermission('recruitment.manage')
  @ApiOperation({ summary: 'Draft a job opening' })
  createOpening(
    @Body({ schema: jobOpeningSchema }) body: z.output<typeof jobOpeningSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.recruitment.createOpening(tenant, auth, body, requestMeta(req));
  }

  @Get('openings/:id')
  opening(
    @Param('id', id()) openingId: Id,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.recruitment.getOpening(tenant, auth, openingId);
  }

  @Patch('openings/:id')
  @RequirePermission('recruitment.manage')
  updateOpening(
    @Param('id', id()) openingId: Id,
    @Body({ schema: updateJobOpeningSchema }) body: z.output<typeof updateJobOpeningSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.recruitment.updateOpening(tenant, auth, openingId, body, requestMeta(req));
  }

  @Post('openings/:id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('recruitment.manage')
  @ApiOperation({ summary: 'Send a draft opening for approval' })
  submitOpening(
    @Param('id', id()) openingId: Id,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.recruitment.submitOpening(tenant, auth, openingId, requestMeta(req));
  }

  @Post('openings/:id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('recruitment.manage')
  @ApiOperation({ summary: 'Put an opening on hold, reopen it or close it' })
  openingStatus(
    @Param('id', id()) openingId: Id,
    @Body({ schema: openingStatusSchema }) body: z.output<typeof openingStatusSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.recruitment.setOpeningStatus(tenant, auth, openingId, body, requestMeta(req));
  }

  @Get('openings/:id/applications')
  applications(
    @Param('id', id()) openingId: Id,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.recruitment.listApplications(tenant, auth, openingId);
  }

  @Post('openings/:id/applications')
  @RequirePermission('recruitment.manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('resume'))
  @ApiOperation({ summary: 'Add a candidate to an open position (optional résumé file "resume")' })
  addApplication(
    @Param('id', id()) openingId: Id,
    @UploadedFile() resume: Upload | undefined,
    @Body({ schema: applicationSchema }) body: z.output<typeof applicationSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.recruitment.addApplication(tenant, auth, openingId, body, resume, requestMeta(req));
  }

  @Get('people')
  @RequirePermission('recruitment.manage')
  @ApiOperation({ summary: 'Members who can be asked to interview' })
  people(
    @Query({ schema: peopleQuerySchema }) q: z.output<typeof peopleQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.recruitment.people(tenant, auth, q.search);
  }

  @Get('applications/:id')
  application(
    @Param('id', id()) applicationId: Id,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.recruitment.getApplication(tenant, auth, applicationId);
  }

  @Get('applications/:id/resume')
  @ApiOperation({ summary: 'Download the candidate’s résumé (audited)' })
  async resume(
    @Param('id', id()) applicationId: Id,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.recruitment.resume(tenant, auth, applicationId, requestMeta(req));
    res.set({
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
    return new StreamableFile(file.data, {
      type: file.mimeType,
      disposition: contentDisposition(file.fileName),
      length: file.data.length,
    });
  }

  @Post('applications/:id/stage')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('recruitment.manage')
  @ApiOperation({ summary: 'Move a candidate to another stage (rejecting or withdrawing needs a reason)' })
  move(
    @Param('id', id()) applicationId: Id,
    @Body({ schema: moveStageSchema }) body: z.output<typeof moveStageSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.recruitment.moveStage(tenant, auth, applicationId, body, requestMeta(req));
  }

  @Post('applications/:id/interviews')
  @RequirePermission('recruitment.manage')
  @ApiOperation({ summary: 'Schedule an interview; the interviewers are told' })
  schedule(
    @Param('id', id()) applicationId: Id,
    @Body({ schema: interviewSchema }) body: z.output<typeof interviewSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.hiring.schedule(tenant, auth, applicationId, body, requestMeta(req));
  }

  @Get('interviews/mine')
  @ApiOperation({ summary: 'Interviews I am on' })
  myInterviews(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.hiring.myInterviews(tenant, auth);
  }

  @Post('interviews/:id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('recruitment.manage')
  interviewStatus(
    @Param('id', id()) interviewId: Id,
    @Body({ schema: interviewStatusSchema }) body: z.output<typeof interviewStatusSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.hiring.setInterviewStatus(tenant, auth, interviewId, body, requestMeta(req));
  }

  @Post('interviews/:id/feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Give my feedback on an interview (final once given)' })
  feedback(
    @Param('id', id()) interviewId: Id,
    @Body({ schema: feedbackSchema }) body: z.output<typeof feedbackSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.hiring.submitFeedback(tenant, auth, interviewId, body, requestMeta(req));
  }

  @Post('applications/:id/offers')
  @RequirePermission('recruitment.manage')
  @ApiOperation({ summary: 'Prepare an offer and send it for approval' })
  offer(
    @Param('id', id()) applicationId: Id,
    @Body({ schema: offerSchema }) body: z.output<typeof offerSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.hiring.createOffer(tenant, auth, applicationId, body, requestMeta(req));
  }

  @Get('offers/:id')
  @ApiOperation({ summary: 'One offer (recruiters and its approvers)' })
  getOffer(
    @Param('id', id()) offerId: Id,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.hiring.getOffer(tenant, auth, offerId);
  }

  @Post('offers/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('recruitment.manage')
  withdrawOffer(
    @Param('id', id()) offerId: Id,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.hiring.cancelOffer(tenant, auth, offerId, requestMeta(req));
  }

  @Post('offers/:id/response')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('recruitment.manage')
  @ApiOperation({ summary: 'Record the candidate accepting or declining an approved offer' })
  respond(
    @Param('id', id()) offerId: Id,
    @Body({ schema: offerResponseSchema }) body: z.output<typeof offerResponseSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.hiring.respond(tenant, auth, offerId, body, requestMeta(req));
  }

  @Post('applications/:id/hire')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('recruitment.manage')
  @ApiOperation({ summary: 'Make the employee record for a candidate who accepted' })
  hire(
    @Param('id', id()) applicationId: Id,
    @Body({ schema: hireSchema }) body: z.output<typeof hireSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.hiring.hire(tenant, auth, applicationId, body, requestMeta(req));
  }
}

@ApiTags('onboarding')
@RequireFeature('onboarding')
@Controller('v1/onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('templates')
  @RequirePermission('onboarding.manage')
  templates(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.onboarding.templates(tenant, auth);
  }

  @Post('templates')
  @RequirePermission('onboarding.manage')
  createTemplate(
    @Body({ schema: onboardingTemplateSchema }) body: z.output<typeof onboardingTemplateSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.onboarding.saveTemplate(tenant, auth, null, body, requestMeta(req));
  }

  @Put('templates/:id')
  @RequirePermission('onboarding.manage')
  updateTemplate(
    @Param('id', id()) templateId: Id,
    @Body({ schema: onboardingTemplateSchema }) body: z.output<typeof onboardingTemplateSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.onboarding.saveTemplate(tenant, auth, templateId, body, requestMeta(req));
  }

  @Get('tasks/mine')
  @ApiOperation({ summary: 'Open onboarding tasks given to me' })
  myTasks(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.onboarding.myTasks(tenant, auth);
  }

  @Post('tasks/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a task done (or skipped, by HR), or reopen it' })
  updateTask(
    @Param('id', id()) taskId: Id,
    @Body({ schema: completeTaskSchema }) body: z.output<typeof completeTaskSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.onboarding.updateTask(tenant, auth, taskId, body, requestMeta(req));
  }

  @Get('employees/:employeeId')
  @ApiOperation({ summary: 'An employee’s onboarding (HR, the employee, their manager)' })
  forEmployee(
    @Param('employeeId', id()) employeeId: Id,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.onboarding.forEmployee(tenant, auth, employeeId);
  }

  @Post('employees/:employeeId')
  @RequirePermission('onboarding.manage')
  @ApiOperation({ summary: 'Start onboarding from a checklist' })
  start(
    @Param('employeeId', id()) employeeId: Id,
    @Body({ schema: startOnboardingSchema }) body: z.output<typeof startOnboardingSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.onboarding.start(tenant, auth, employeeId, body.templateId, body.startDate, requestMeta(req));
  }

  @Post('plans/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('onboarding.manage')
  cancel(
    @Param('id', id()) planId: Id,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.onboarding.cancel(tenant, auth, planId, requestMeta(req));
  }
}
