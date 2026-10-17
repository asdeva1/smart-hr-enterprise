import {
  Body,
  Controller,
  Delete,
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
  allocationSchema,
  balanceAdjustmentSchema,
  balanceQuerySchema,
  createHolidayCalendarSchema,
  createLeaveTypeSchema,
  holidaySchema,
  yearQuerySchema,
  leaveCalendarQuerySchema,
  leaveCancelSchema,
  leaveListQuerySchema,
  leavePreviewSchema,
  leaveRequestSchema,
  updateHolidayCalendarSchema,
  updateHolidaySchema,
  updateLeaveTypeSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import {
  CurrentAuth,
  CurrentTenant,
  RequireFeature,
  RequirePermission,
  RequireTenant,
} from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { HolidaysService } from './holidays.service.js';
import { LeaveService } from './leave.service.js';

/**
 * Leave. Anyone linked to an employee record can see their balances and apply; managers see their reporting
 * line; `leave.view`, `leave.manage` and `leave.configure` cover parts of the organisation. The service
 * checks the scope of each employee.
 */
@ApiTags('leave')
@RequireTenant()
@RequireFeature('leave.basic')
@Controller('v1/leave')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Get('types')
  @ApiOperation({ summary: 'Leave types' })
  types(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.leave.listTypes(tenant, auth);
  }

  @Post('types')
  @RequirePermission('leave.configure')
  @ApiOperation({ summary: 'Create a leave type (leave.configure, whole organisation)' })
  createType(
    @Body({ schema: createLeaveTypeSchema }) body: z.output<typeof createLeaveTypeSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.leave.createType(tenant, auth, body, requestMeta(req));
  }

  @Patch('types/:id')
  @RequirePermission('leave.configure')
  @ApiOperation({ summary: 'Change or archive a leave type' })
  updateType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateLeaveTypeSchema }) body: z.output<typeof updateLeaveTypeSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.leave.updateType(tenant, auth, id, body, requestMeta(req));
  }

  @Get('me/balances')
  @ApiOperation({ summary: 'My balances for a year' })
  myBalances(
    @Query({ schema: yearQuerySchema }) q: z.output<typeof yearQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.leave.myBalances(tenant, auth, q.year);
  }

  @Get('balances')
  @ApiOperation({ summary: 'Balances for the people I can see' })
  balances(
    @Query({ schema: balanceQuerySchema }) q: z.output<typeof balanceQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.leave.balances(tenant, auth, q);
  }

  @Get('employees/:id/balances')
  @ApiOperation({ summary: 'One employee’s balances and their ledger for a year' })
  employeeBalances(
    @Param('id', ParseUUIDPipe) id: string,
    @Query({ schema: yearQuerySchema }) q: z.output<typeof yearQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.leave.employeeBalances(tenant, auth, id, q.year);
  }

  @Post('adjustments')
  @RequirePermission('leave.manage')
  @ApiOperation({ summary: 'Add or take away days, with a reason (never one’s own balance)' })
  adjust(
    @Body({ schema: balanceAdjustmentSchema }) body: z.output<typeof balanceAdjustmentSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.leave.adjust(tenant, auth, body, requestMeta(req));
  }

  @Post('allocations')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('leave.manage')
  @ApiOperation({ summary: 'Credit what is due for a year to everyone (safe to repeat)' })
  allocate(
    @Body({ schema: allocationSchema }) body: z.output<typeof allocationSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.leave.allocate(tenant, auth, body, requestMeta(req));
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'How many days a request would use, and the balance afterwards' })
  preview(
    @Body({ schema: leavePreviewSchema }) body: z.output<typeof leavePreviewSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.leave.preview(tenant, auth, body);
  }

  @Post('requests')
  @ApiOperation({
    summary: 'Apply for leave (for myself, or for someone with leave.manage); goes for approval',
  })
  create(
    @Body({ schema: leaveRequestSchema }) body: z.output<typeof leaveRequestSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.leave.create(tenant, auth, body, requestMeta(req));
  }

  @Get('requests')
  @ApiOperation({ summary: 'My leave, or the leave of the people I can see' })
  list(
    @Query({ schema: leaveListQuerySchema }) q: z.output<typeof leaveListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.leave.list(tenant, auth, q);
  }

  @Get('requests/:id')
  @ApiOperation({ summary: 'One leave request and its approval' })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.leave.get(tenant, auth, id);
  }

  @Post('requests/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw an open request, or cancel approved leave' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: leaveCancelSchema }) body: z.output<typeof leaveCancelSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.leave.cancel(tenant, auth, id, body.reason, requestMeta(req));
  }

  @Get('calendar')
  @ApiOperation({ summary: 'Who is away when (up to two months)' })
  calendar(
    @Query({ schema: leaveCalendarQuerySchema }) q: z.output<typeof leaveCalendarQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.leave.calendar(tenant, auth, q);
  }
}

/** Holiday calendars. Used by attendance and by leave, so either plan feature is enough. */
@ApiTags('holidays')
@RequireTenant()
@RequireFeature('attendance.basic', 'leave.basic')
@Controller('v1/holidays')
export class HolidaysController {
  constructor(private readonly holidays: HolidaysService) {}

  @Get('mine')
  @ApiOperation({ summary: 'The holidays that apply to me in a year' })
  mine(
    @Query({ schema: yearQuerySchema }) q: z.output<typeof yearQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.holidays.mine(tenant, auth, q.year);
  }

  @Get('calendars')
  @RequirePermission('leave.configure')
  @ApiOperation({ summary: 'All holiday calendars' })
  calendars(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.holidays.listCalendars(tenant, auth);
  }

  @Post('calendars')
  @RequirePermission('leave.configure')
  @ApiOperation({ summary: 'Create a calendar for the organisation, a company or a branch' })
  createCalendar(
    @Body({ schema: createHolidayCalendarSchema }) body: z.output<typeof createHolidayCalendarSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.holidays.createCalendar(tenant, auth, body, requestMeta(req));
  }

  @Patch('calendars/:id')
  @RequirePermission('leave.configure')
  @ApiOperation({ summary: 'Rename or archive a calendar' })
  updateCalendar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateHolidayCalendarSchema }) body: z.output<typeof updateHolidayCalendarSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.holidays.updateCalendar(tenant, auth, id, body, requestMeta(req));
  }

  @Get('calendars/:id/holidays')
  @RequirePermission('leave.configure')
  @ApiOperation({ summary: 'A calendar’s holidays for a year' })
  listHolidays(
    @Param('id', ParseUUIDPipe) id: string,
    @Query({ schema: yearQuerySchema }) q: z.output<typeof yearQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.holidays.listHolidays(tenant, auth, id, q.year);
  }

  @Post('calendars/:id/holidays')
  @RequirePermission('leave.configure')
  @ApiOperation({ summary: 'Add a holiday' })
  addHoliday(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: holidaySchema }) body: z.output<typeof holidaySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.holidays.addHoliday(tenant, auth, id, body, requestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('leave.configure')
  @ApiOperation({ summary: 'Rename a holiday or make it optional' })
  updateHoliday(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateHolidaySchema }) body: z.output<typeof updateHolidaySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.holidays.updateHoliday(tenant, auth, id, body, requestMeta(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('leave.configure')
  @ApiOperation({ summary: 'Remove a holiday' })
  async removeHoliday(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    await this.holidays.removeHoliday(tenant, auth, id, requestMeta(req));
  }
}
