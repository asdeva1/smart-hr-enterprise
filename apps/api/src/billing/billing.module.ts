import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CheckoutController } from './checkout.controller.js';
import { CheckoutService } from './checkout.service.js';
import { RazorpayProvider } from './razorpay.provider.js';

/** Buying a plan on the website. Off unless CHECKOUT_ENABLED=true; see docs/deployment/CHECKOUT.md. */
@Module({
  imports: [AuthModule],
  controllers: [CheckoutController],
  providers: [CheckoutService, RazorpayProvider],
})
export class BillingModule {}
