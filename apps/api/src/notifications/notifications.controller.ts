import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { notificationPreferenceSchema } from '@smart-hr/validation';
import { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequireTenant } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { NotificationService } from './notification.service.js';

const listQuery = z.object({ unread: z.stringbool().default(false) });

@ApiTags('notifications')
@RequireTenant()
@Controller('v1/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'My latest notifications in this organisation, with the unread count' })
  list(
    @Query({ schema: listQuery }) query: z.output<typeof listQuery>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.notifications.list(tenant, auth, query.unread);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark one notification read' })
  async markRead(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    await this.notifications.markRead(tenant, auth, id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all my notifications read' })
  markAllRead(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.notifications.markAllRead(tenant, auth);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Which notifications I also get by email' })
  preferences(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.notifications.preferences(tenant, auth);
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Turn email on or off for one category' })
  setPreference(
    @Body({ schema: notificationPreferenceSchema }) body: z.output<typeof notificationPreferenceSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.notifications.setPreference(tenant, auth, body.category, body.emailEnabled);
  }
}
