import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, CurrentTenant, RequireFeature, RequireTenant } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { OverviewService } from './overview.service.js';
import { SelfServiceService } from './selfservice.service.js';

@ApiTags('self-service')
@Controller('v1/me')
export class SelfServiceController {
  constructor(
    private readonly selfService: SelfServiceService,
    private readonly overview: OverviewService,
  ) {}

  @Get('home')
  @RequireFeature('self_service.employee')
  home(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.selfService.home(tenant, auth);
  }

  /** People, money and projects at a glance, for the dashboard. Each area depends on plan and permission. */
  @Get('overview')
  @RequireTenant()
  overviewOf(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.overview.overview(tenant, auth);
  }

  @Get('team')
  @RequireFeature('self_service.manager')
  team(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.selfService.team(tenant, auth);
  }
}
