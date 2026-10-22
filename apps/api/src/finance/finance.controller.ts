import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  bookLockSchema,
  journalListQuerySchema,
  journalSchema,
  ledgerAccountSchema,
  ledgerQuerySchema,
  reportQuerySchema,
  reverseJournalSchema,
  updateJournalSchema,
  updateLedgerAccountSchema,
} from '@smart-hr/validation';
import { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequireFeature, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { BooksService } from './books.service.js';
import { ReportsService } from './reports.service.js';

const id = () => new ParseUUIDPipe();
const companyQuery = z.object({ companyId: z.uuid() });
const dateOnlyQuery = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bookQuerySchema = z.object({ companyId: z.uuid(), from: dateOnlyQuery, to: dateOnlyQuery });
const cashBookQuerySchema = bookQuerySchema.extend({ kind: z.enum(['CASH', 'BANK', 'ALL']).default('ALL') });

@ApiTags('finance')
@RequireFeature('finance')
@Controller('v1/finance')
export class FinanceController {
  constructor(
    private readonly books: BooksService,
    private readonly reports: ReportsService,
  ) {}

  @Get('accounts')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'A company’s chart of accounts (the starting chart is created the first time)' })
  accounts(
    @Query({ schema: companyQuery }) q: z.output<typeof companyQuery>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.books.accounts(tenant, auth, q.companyId);
  }

  @Post('accounts')
  @RequirePermission('finance.configure')
  createAccount(
    @Body({ schema: ledgerAccountSchema }) body: z.output<typeof ledgerAccountSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.books.createAccount(tenant, auth, body, requestMeta(req));
  }

  @Patch('accounts/:id')
  @RequirePermission('finance.configure')
  updateAccount(
    @Param('id', id()) accountId: string,
    @Body({ schema: updateLedgerAccountSchema }) body: z.output<typeof updateLedgerAccountSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.books.updateAccount(tenant, auth, accountId, body, requestMeta(req));
  }

  @Get('accounts/:id/ledger')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'An account’s ledger with opening and running balances' })
  ledger(
    @Param('id', id()) accountId: string,
    @Query({ schema: ledgerQuerySchema }) q: z.output<typeof ledgerQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.reports.ledger(tenant, auth, accountId, q.from, q.to);
  }

  @Get('journals')
  @RequirePermission('finance.view')
  journals(
    @Query({ schema: journalListQuerySchema }) q: z.output<typeof journalListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.books.listJournals(tenant, auth, q);
  }

  @Post('journals')
  @RequirePermission('finance.manage')
  @ApiOperation({ summary: 'Draft a journal (it posts once approved)' })
  createJournal(
    @Body({ schema: journalSchema }) body: z.output<typeof journalSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.books.createJournal(tenant, auth, body, requestMeta(req));
  }

  @Get('journals/:id')
  journal(
    @Param('id', id()) journalId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.books.getJournal(tenant, auth, journalId);
  }

  @Put('journals/:id')
  @RequirePermission('finance.manage')
  updateJournal(
    @Param('id', id()) journalId: string,
    @Body({ schema: updateJournalSchema }) body: z.output<typeof updateJournalSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.books.updateJournal(tenant, auth, journalId, body, requestMeta(req));
  }

  @Post('journals/:id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.manage')
  submit(
    @Param('id', id()) journalId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.books.submitJournal(tenant, auth, journalId, requestMeta(req));
  }

  @Post('journals/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.manage')
  cancel(
    @Param('id', id()) journalId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.books.cancelJournal(tenant, auth, journalId, requestMeta(req));
  }

  @Post('journals/:id/reverse')
  @RequirePermission('finance.manage')
  @ApiOperation({ summary: 'Reverse a posted journal with a mirror journal' })
  reverse(
    @Param('id', id()) journalId: string,
    @Body({ schema: reverseJournalSchema }) body: z.output<typeof reverseJournalSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.books.reverseJournal(tenant, auth, journalId, body, requestMeta(req));
  }

  @Get('books-of-accounts/day-book')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'Day book: every posted journal in a period' })
  dayBook(
    @Query({ schema: bookQuerySchema }) q: z.output<typeof bookQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.reports.dayBook(tenant, auth, q.companyId, q.from, q.to);
  }

  @Get('books-of-accounts/cash-book')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'Cash book and bank book with opening and running balances' })
  cashBook(
    @Query({ schema: cashBookQuerySchema }) q: z.output<typeof cashBookQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.reports.cashBook(tenant, auth, q.companyId, q.from, q.to, q.kind);
  }

  @Get('reports/trial-balance')
  @RequirePermission('finance.view')
  trialBalance(
    @Query({ schema: reportQuerySchema }) q: z.output<typeof reportQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.reports.trialBalance(tenant, auth, q.companyId, q.to);
  }

  @Get('reports/profit-and-loss')
  @RequirePermission('finance.view')
  profitAndLoss(
    @Query({ schema: reportQuerySchema }) q: z.output<typeof reportQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    const from =
      q.from ?? `${Number(q.to.slice(5, 7)) >= 4 ? q.to.slice(0, 4) : Number(q.to.slice(0, 4)) - 1}-04-01`;
    return this.reports.profitAndLoss(tenant, auth, q.companyId, from, q.to);
  }

  @Get('reports/balance-sheet')
  @RequirePermission('finance.view')
  balanceSheet(
    @Query({ schema: reportQuerySchema }) q: z.output<typeof reportQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.reports.balanceSheet(tenant, auth, q.companyId, q.to);
  }

  @Get('books/:companyId')
  @RequirePermission('finance.view')
  lock(
    @Param('companyId', id()) companyId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.books.lock(tenant, auth, companyId);
  }

  @Put('books/:companyId')
  @RequirePermission('finance.configure')
  @ApiOperation({ summary: 'Close the books up to a date (or reopen them)' })
  setLock(
    @Param('companyId', id()) companyId: string,
    @Body({ schema: bookLockSchema }) body: z.output<typeof bookLockSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.books.setLock(tenant, auth, companyId, body, requestMeta(req));
  }
}
