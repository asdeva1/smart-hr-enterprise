import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { contactSalesSchema } from '@smart-hr/validation';
import type { z } from 'zod';
import { Public } from '../auth/auth.decorators.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { ContactService } from './contact.service.js';
import { PublicPlansService } from './public-plans.service.js';

@ApiTags('public')
@Public()
@Controller('v1/public')
export class PublicPlansController {
  constructor(
    private readonly plans: PublicPlansService,
    private readonly contact: ContactService,
  ) {}

  @Get('plans')
  // Cacheable for a few minutes: it is the same for everyone and changes only when an operator publishes.
  @Header('Cache-Control', 'public, max-age=300, s-maxage=300')
  @ApiOperation({ summary: 'Published plans for the marketing website (no organisation data)' })
  async list() {
    return { plans: await this.plans.list() };
  }

  @Post('contact')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send a "contact us" message from the website to the sales inbox' })
  async contactSales(
    @Body({ schema: contactSalesSchema }) body: z.output<typeof contactSalesSchema>,
    @Req() req: AppRequest,
  ) {
    await this.contact.submit(body, requestMeta(req));
    return { status: 'received' };
  }
}
