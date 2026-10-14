import { Global, Module } from '@nestjs/common';
import { InvitationService } from './invitation.service.js';
import { TenantProvisioner } from './tenant-provisioner.js';

/** Identity services shared by member administration, the platform console and self-service sign-up. */
@Global()
@Module({
  providers: [InvitationService, TenantProvisioner],
  exports: [InvitationService, TenantProvisioner],
})
export class IdentityModule {}
