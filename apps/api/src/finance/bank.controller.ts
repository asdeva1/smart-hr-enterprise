import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  bankAccountQuerySchema,
  bankIgnoreSchema,
  bankImportSchema,
  bankLinesQuerySchema,
  bankMatchSchema,
  bankSummaryQuerySchema,
} from '@smart-hr/validation';
import { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequireFeature, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { BankService } from './bank.service.js';

const id = () => new ParseUUIDPipe();
const companyQuery = z.object({ companyId: z.uuid() });
const bookItemsQuery = bankAccountQuerySchema.extend({
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

@ApiTags('finance')
@RequireFeature('finance')
@Controller('v1/finance/bank')
export class BankController {
  constructor(private readonly bank: BankService) {}

  @Get('accounts')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'Accounts of a company that can be reconciled (bank first)' })
  accounts(
    @Query({ schema: companyQuery }) q: z.output<typeof companyQuery>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.bank.accounts(tenant, auth, q.companyId);
  }

  @Post('statements')
  @RequirePermission('finance.manage')
  @ApiOperation({ summary: 'Import a bank statement; lines already imported are skipped' })
  import(
    @Body({ schema: bankImportSchema }) body: z.output<typeof bankImportSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.bank.importStatement(tenant, auth, body, requestMeta(req));
  }

  @Get('statements')
  @RequirePermission('finance.view')
  statements(
    @Query({ schema: bankAccountQuerySchema }) q: z.output<typeof bankAccountQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.bank.statements(tenant, auth, q.companyId, q.accountId);
  }

  @Get('lines')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'Statement lines with suggested matches for the unmatched ones' })
  lines(
    @Query({ schema: bankLinesQuerySchema }) q: z.output<typeof bankLinesQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.bank.lines(tenant, auth, q);
  }

  @Get('book-items')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'Entries in the books that are not on the bank statement' })
  bookItems(
    @Query({ schema: bookItemsQuery }) q: z.output<typeof bookItemsQuery>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.bank.bookItems(tenant, auth, q.companyId, q.accountId, q.to);
  }

  @Get('summary')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'Book balance, statement balance and what is left to reconcile' })
  summary(
    @Query({ schema: bankSummaryQuerySchema }) q: z.output<typeof bankSummaryQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.bank.summary(tenant, auth, q.companyId, q.accountId, q.asOf);
  }

  @Post('auto-match')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.manage')
  @ApiOperation({ summary: 'Match every statement line that has exactly one possible entry' })
  autoMatch(
    @Body({ schema: bankAccountQuerySchema }) body: z.output<typeof bankAccountQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.bank.autoMatch(tenant, auth, body.companyId, body.accountId, requestMeta(req));
  }

  @Post('lines/:id/match')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.manage')
  match(
    @Param('id', id()) lineId: string,
    @Body({ schema: bankMatchSchema }) body: z.output<typeof bankMatchSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.bank.match(tenant, auth, lineId, body.journalLineId, requestMeta(req));
  }

  @Post('lines/:id/unmatch')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.manage')
  unmatch(
    @Param('id', id()) lineId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.bank.unmatch(tenant, auth, lineId, requestMeta(req));
  }

  @Post('lines/:id/ignore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.manage')
  ignore(
    @Param('id', id()) lineId: string,
    @Body({ schema: bankIgnoreSchema }) body: z.output<typeof bankIgnoreSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.bank.ignore(tenant, auth, lineId, body.note ?? null, requestMeta(req));
  }
}
