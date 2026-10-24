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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  adminPunchSchema,
  assignShiftSchema,
  attendancePolicySchema,
  clearRosterSchema,
  decideOvertimeSchema,
  overtimeQuerySchema,
  rosterQuerySchema,
  setRosterSchema,
  updateWorkLocationSchema,
  workLocationSchema,
  attendanceRangeSchema,
  correctionListQuerySchema,
  correctionSchema,
  createShiftSchema,
  punchSchema,
  registerQuerySchema,
  teamDayQuerySchema,
  updateShiftSchema,
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
import { AdvancedAttendanceService } from './advanced-attendance.service.js';
import { AttendanceService } from './attendance.service.js';
import { CorrectionsService } from './corrections.service.js';
import { ShiftsService } from './shifts.service.js';

/**
 * Attendance. Everyone linked to an employee record can clock in and see their own days; managers see their
 * reporting line; `attendance.view`, `attendance.manage` and `attendance.configure` cover parts of the
 * organisation. The services check the scope of each employee.
 */
@ApiTags('attendance')
@RequireTenant()
@RequireFeature('attendance.basic')
@Controller('v1/attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly shifts: ShiftsService,
    private readonly corrections: CorrectionsService,
  ) {}

  @Get('me/today')
  @ApiOperation({ summary: 'My shift, clock-ins and status for the current day' })
  today(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.attendance.today(tenant, auth);
  }

  @Post('me/punch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clock in or out now' })
  punch(
    @Body({ schema: punchSchema }) body: z.output<typeof punchSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.attendance.punch(tenant, auth, body.direction, new Date(), body.location);
  }

  @Get('me/days')
  @ApiOperation({ summary: 'My days over a range (at most 62 days)' })
  myDays(
    @Query({ schema: attendanceRangeSchema }) q: z.output<typeof attendanceRangeSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.attendance.myDays(tenant, auth, q);
  }

  @Get('employees/:id/days')
  @ApiOperation({ summary: 'One employee’s days (their own, their reporting line, or attendance.view)' })
  employeeDays(
    @Param('id', ParseUUIDPipe) id: string,
    @Query({ schema: attendanceRangeSchema }) q: z.output<typeof attendanceRangeSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.attendance.employeeDays(tenant, auth, id, q);
  }

  @Get('employees/:id/shifts')
  @ApiOperation({ summary: 'One employee’s shift history' })
  shiftHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.shifts.history(tenant, auth, id);
  }

  @Get('team')
  @ApiOperation({ summary: 'Everyone the member can see, for one day, with counts' })
  team(
    @Query({ schema: teamDayQuerySchema }) q: z.output<typeof teamDayQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.attendance.team(tenant, auth, q);
  }

  @Get('register')
  @ApiOperation({ summary: 'Monthly register: one row per employee, one status per day' })
  register(
    @Query({ schema: registerQuerySchema }) q: z.output<typeof registerQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.attendance.register(tenant, auth, q);
  }

  @Post('punches')
  @RequirePermission('attendance.manage')
  @ApiOperation({ summary: 'Record a clock-in or clock-out on someone’s behalf, with a reason (audited)' })
  recordPunch(
    @Body({ schema: adminPunchSchema }) body: z.output<typeof adminPunchSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.attendance.recordPunch(tenant, auth, body, requestMeta(req));
  }

  @Get('shifts')
  @ApiOperation({ summary: 'Shifts, with how many current employees work each' })
  listShifts(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.shifts.list(tenant, auth);
  }

  @Post('shifts')
  @RequirePermission('attendance.configure')
  @ApiOperation({ summary: 'Create a shift (attendance.configure, whole organisation)' })
  createShift(
    @Body({ schema: createShiftSchema }) body: z.output<typeof createShiftSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.shifts.create(tenant, auth, body, requestMeta(req));
  }

  @Patch('shifts/:id')
  @RequirePermission('attendance.configure')
  @ApiOperation({ summary: 'Change or archive a shift' })
  updateShift(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateShiftSchema }) body: z.output<typeof updateShiftSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.shifts.update(tenant, auth, id, body, requestMeta(req));
  }

  @Post('shift-assignments')
  @RequirePermission('attendance.manage')
  @ApiOperation({ summary: 'Put employees, or a part of the organisation, on a shift from a date' })
  assign(
    @Body({ schema: assignShiftSchema }) body: z.output<typeof assignShiftSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.shifts.assign(tenant, auth, body, requestMeta(req));
  }

  @Post('corrections')
  @ApiOperation({ summary: 'Ask for a day’s times to be corrected; goes for approval' })
  requestCorrection(
    @Body({ schema: correctionSchema }) body: z.output<typeof correctionSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.corrections.create(tenant, auth, body, requestMeta(req));
  }

  @Get('corrections')
  @ApiOperation({ summary: 'My corrections, or those of the people I can see' })
  listCorrections(
    @Query({ schema: correctionListQuerySchema }) q: z.output<typeof correctionListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.corrections.list(tenant, auth, q);
  }

  @Get('corrections/:id')
  @ApiOperation({ summary: 'One correction and its approval' })
  getCorrection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.corrections.get(tenant, auth, id);
  }

  @Post('corrections/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw my open correction' })
  cancelCorrection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.corrections.cancel(tenant, auth, id, requestMeta(req));
  }
}

/** Rosters, overtime approval, attendance rules and work locations. Needs the advanced attendance module. */
@ApiTags('attendance')
@RequireTenant()
@RequireFeature('attendance.advanced')
@Controller('v1/attendance')
export class AdvancedAttendanceController {
  constructor(private readonly advanced: AdvancedAttendanceService) {}

  @Get('policy')
  @RequirePermission('attendance.view')
  @ApiOperation({ summary: 'The organisation’s attendance rules' })
  policy(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.advanced.getPolicy(tenant, auth);
  }

  @Put('policy')
  @RequirePermission('attendance.configure')
  @ApiOperation({ summary: 'Save the attendance rules (overtime, corrections, location)' })
  savePolicy(
    @Body({ schema: attendancePolicySchema }) body: z.output<typeof attendancePolicySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.advanced.savePolicy(tenant, auth, body, requestMeta(req));
  }

  @Get('locations')
  @RequirePermission('attendance.view')
  @ApiOperation({ summary: 'Work locations employees may clock in from' })
  locations(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.advanced.locations(tenant, auth);
  }

  @Post('locations')
  @RequirePermission('attendance.configure')
  @ApiOperation({ summary: 'Add a work location' })
  createLocation(
    @Body({ schema: workLocationSchema }) body: z.output<typeof workLocationSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.advanced.createLocation(tenant, auth, body, requestMeta(req));
  }

  @Patch('locations/:id')
  @RequirePermission('attendance.configure')
  @ApiOperation({ summary: 'Change or retire a work location' })
  updateLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateWorkLocationSchema }) body: z.output<typeof updateWorkLocationSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.advanced.updateLocation(tenant, auth, id, body, requestMeta(req));
  }

  @Get('roster')
  @RequirePermission('attendance.manage')
  @ApiOperation({ summary: 'Who works which shift on each date' })
  roster(
    @Query({ schema: rosterQuerySchema }) query: z.output<typeof rosterQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.advanced.roster(tenant, auth, query);
  }

  @Put('roster')
  @RequirePermission('attendance.manage')
  @ApiOperation({ summary: 'Put people on a shift or a day off for a run of dates' })
  setRoster(
    @Body({ schema: setRosterSchema }) body: z.output<typeof setRosterSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.advanced.setRoster(tenant, auth, body, requestMeta(req));
  }

  @Post('roster/clear')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('attendance.manage')
  @ApiOperation({ summary: 'Go back to the usual shift for a run of dates' })
  clearRoster(
    @Body({ schema: clearRosterSchema }) body: z.output<typeof clearRosterSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.advanced.clearRoster(tenant, auth, body, requestMeta(req));
  }

  @Get('overtime')
  @RequirePermission('attendance.manage')
  @ApiOperation({ summary: 'Overtime worked, and what has been approved' })
  overtime(
    @Query({ schema: overtimeQuerySchema }) query: z.output<typeof overtimeQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.advanced.overtime(tenant, auth, query);
  }

  @Post('overtime/decide')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('attendance.manage')
  @ApiOperation({ summary: 'Approve or reject the overtime on a day' })
  decide(
    @Body({ schema: decideOvertimeSchema }) body: z.output<typeof decideOvertimeSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.advanced.decideOvertime(tenant, auth, body, requestMeta(req));
  }
}
