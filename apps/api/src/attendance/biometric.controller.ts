import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  biometricDeviceSchema,
  biometricDeviceUpdateSchema,
  biometricLinkSchema,
  biometricLogQuerySchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import {
  CurrentAuth,
  CurrentTenant,
  Public,
  RequireFeature,
  RequirePermission,
  RequireTenant,
} from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { BiometricIngestService } from './biometric-ingest.service.js';
import { BiometricService } from './biometric.service.js';

/** Setting up biometric machines (eSSL and other ZKTeco-based devices). */
@ApiTags('attendance')
@RequireTenant()
@RequireFeature('attendance.basic')
@RequirePermission('attendance.configure')
@Controller('v1/attendance/biometric')
export class BiometricController {
  constructor(private readonly biometric: BiometricService) {}

  @Get('devices')
  @ApiOperation({ summary: 'Registered biometric machines' })
  devices(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.biometric.devices(tenant, auth);
  }

  @Post('devices')
  @ApiOperation({ summary: 'Register a biometric machine by its serial number' })
  createDevice(
    @Body({ schema: biometricDeviceSchema }) body: z.output<typeof biometricDeviceSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.biometric.createDevice(tenant, auth, body, requestMeta(req));
  }

  @Patch('devices/:id')
  @ApiOperation({ summary: 'Rename, move, change the time zone of, or archive a machine' })
  updateDevice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: biometricDeviceUpdateSchema }) body: z.output<typeof biometricDeviceUpdateSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.biometric.updateDevice(tenant, auth, id, body, requestMeta(req));
  }

  @Get('links')
  @ApiOperation({ summary: 'User numbers linked to employees, and scans from numbers not linked yet' })
  links(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.biometric.links(tenant, auth);
  }

  @Post('links')
  @ApiOperation({ summary: 'Link a machine user ID to an employee' })
  link(
    @Body({ schema: biometricLinkSchema }) body: z.output<typeof biometricLinkSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.biometric.link(tenant, auth, body, requestMeta(req));
  }

  @Delete('links/:id')
  @ApiOperation({ summary: 'Remove a link' })
  unlink(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.biometric.unlink(tenant, auth, id, requestMeta(req));
  }

  @Get('logs')
  @ApiOperation({ summary: 'Recent scans received from the machines' })
  logs(
    @Query({ schema: biometricLogQuerySchema }) q: z.output<typeof biometricLogQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.biometric.logs(tenant, auth, q);
  }
}

const TEXT = 'text/plain; charset=utf-8';

/**
 * The address eSSL and other ZKTeco-based machines push to ("ADMS" / cloud server). There is no login: a
 * machine is recognised by its registered serial number. Responses are the plain text these machines expect.
 */
@ApiTags('biometric-devices')
@Public()
@Controller('iclock')
export class IclockController {
  constructor(private readonly ingest: BiometricIngestService) {}

  /** Start-up handshake: the machine asks how the server wants it to behave. */
  @Get('cdata')
  @Header('Content-Type', TEXT)
  @Header('Cache-Control', 'no-store')
  async handshake(@Query('SN') sn: string | undefined) {
    const serial = sn ?? '';
    const device = await this.ingest.find(serial);
    if (!device) throw new NotFoundException();
    return this.ingest.handshake(device, serial);
  }

  /** Upload: the ATTLOG table carries the scans; other tables are acknowledged and ignored. */
  @Post('cdata')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', TEXT)
  @Header('Cache-Control', 'no-store')
  async upload(
    @Query('SN') sn: string | undefined,
    @Query('table') table: string | undefined,
    @Query('Stamp') stamp: string | undefined,
    @Req() req: AppRequest,
  ) {
    const device = await this.ingest.find(sn ?? '');
    if (!device) throw new NotFoundException();
    if (table !== 'ATTLOG') return 'OK';
    const body: unknown = (req as { body?: unknown }).body;
    const count = await this.ingest.receive(device, typeof body === 'string' ? body : '', stamp);
    return `OK: ${count}`;
  }

  /** The machine polls for commands; there are none. */
  @Get('getrequest')
  @Header('Content-Type', TEXT)
  @Header('Cache-Control', 'no-store')
  async getRequest(@Query('SN') sn: string | undefined) {
    if (!(await this.ingest.find(sn ?? ''))) throw new NotFoundException();
    return 'OK';
  }

  /** The machine reports the result of a command. */
  @Post('devicecmd')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', TEXT)
  deviceCommand() {
    return 'OK';
  }
}
