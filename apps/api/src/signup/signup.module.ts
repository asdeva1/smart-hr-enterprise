import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PublicPlansController } from './public-plans.controller.js';
import { PublicPlansService } from './public-plans.service.js';
import { SignupController } from './signup.controller.js';
import { SignupService } from './signup.service.js';

@Module({
  imports: [AuthModule],
  controllers: [SignupController, PublicPlansController],
  providers: [SignupService, PublicPlansService],
})
export class SignupModule {}
