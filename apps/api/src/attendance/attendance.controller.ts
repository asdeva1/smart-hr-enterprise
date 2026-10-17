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
  adminPunchSchema,
  assignShiftSchema,
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
    return this.attendance.punch(tenant, auth, body.direction);
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
