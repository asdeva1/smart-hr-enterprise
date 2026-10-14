import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { completeSignupSchema, signupSchema } from '@smart-hr/validation';
import type { z } from 'zod';
import { Public } from '../auth/auth.decorators.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { SignupService } from './signup.service.js';

@ApiTags('signup')
@Public()
@Controller('v1/signup')
export class SignupController {
  constructor(private readonly signup: SignupService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Start a self-service sign-up (emails a link); same answer for every address' })
  async request(@Body({ schema: signupSchema }) body: z.output<typeof signupSchema>, @Req() req: AppRequest) {
    await this.signup.request(body, requestMeta(req));
    return { status: 'check-your-email' };
  }

  @Post('complete')
  @ApiOperation({ summary: 'Finish sign-up from the emailed link: creates the account and organisation' })
  complete(
    @Body({ schema: completeSignupSchema }) body: z.output<typeof completeSignupSchema>,
    @Req() req: AppRequest,
  ) {
    return this.signup.complete(body, requestMeta(req));
  }
}
