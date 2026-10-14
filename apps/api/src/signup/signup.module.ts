import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SignupController } from './signup.controller.js';
import { SignupService } from './signup.service.js';

@Module({ imports: [AuthModule], controllers: [SignupController], providers: [SignupService] })
export class SignupModule {}
