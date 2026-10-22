import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountSecurityController } from './account-security.controller.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { OneTimeCodeService } from './one-time-code.service.js';
import { RateLimiterService } from './rate-limiter.service.js';
import { SessionService } from './session.service.js';

@Module({
  controllers: [AuthController, AccountSecurityController],
  providers: [
    AuthService,
    SessionService,
    RateLimiterService,
    OneTimeCodeService,
    // Every route in the application requires a session unless marked @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [SessionService, RateLimiterService],
})
export class AuthModule {}
