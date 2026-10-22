import { Body, Controller, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { checkoutSchema, confirmCheckoutSchema } from '@smart-hr/validation';
import type { z } from 'zod';
import { Public } from '../auth/auth.decorators.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { CheckoutService } from './checkout.service.js';

@ApiTags('billing')
@Public()
@Controller('v1')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post('checkout')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start buying a plan: prices an order and opens it with the payment provider' })
  start(@Body({ schema: checkoutSchema }) body: z.output<typeof checkoutSchema>, @Req() req: AppRequest) {
    return this.checkout.start(body, requestMeta(req));
  }

  @Post('checkout/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The browser reports a finished payment; its signature is verified here' })
  confirm(
    @Body({ schema: confirmCheckoutSchema }) body: z.output<typeof confirmCheckoutSchema>,
    @Req() req: AppRequest,
  ) {
    return this.checkout.confirm(body, requestMeta(req));
  }

  @Post('billing/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Signed events from the payment provider' })
  webhook(
    @Req() req: AppRequest & { rawBody?: Buffer },
    @Headers('x-razorpay-signature') signature: string | undefined,
  ) {
    return this.checkout.webhook(req.rawBody, signature, requestMeta(req));
  }
}
