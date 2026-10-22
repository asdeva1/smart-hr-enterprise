import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/auth.decorators.js';
import { PublicPlansService } from './public-plans.service.js';

@ApiTags('public')
@Public()
@Controller('v1/public')
export class PublicPlansController {
  constructor(private readonly plans: PublicPlansService) {}

  @Get('plans')
  // Cacheable for a few minutes: it is the same for everyone and changes only when an operator publishes.
  @Header('Cache-Control', 'public, max-age=300, s-maxage=300')
  @ApiOperation({ summary: 'Published plans for the marketing website (no organisation data)' })
  async list() {
    return { plans: await this.plans.list() };
  }
}
