import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  customerSchema,
  receiptSchema,
  salesAgeingQuerySchema,
  salesCompanyQuerySchema,
  salesDocumentListSchema,
  salesDocumentSchema,
  salesSettingSchema,
  salesStatementQuerySchema,
  templateSchema,
  updateCustomerSchema,
  updateSalesDocumentSchema,
  updateTemplateSchema,
} from '@smart-hr/validation';
import { z } from 'zod';
import { CurrentAuth, CurrentTenant, RequireFeature, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { SalesService } from './sales.service.js';

const id = () => new ParseUUIDPipe();
const customerListQuery = z.object({ q: z.string().trim().max(80).optional() });
const receiptListQuery = z.object({ companyId: z.uuid(), customerId: z.uuid().optional() });
const statementQuery = salesStatementQuerySchema;

/** Customers, invoices and other sales documents, receipts, and receivables reports. */
@ApiTags('sales')
@RequireFeature('finance')
@Controller('v1/finance/sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get('customers')
  @RequirePermission('finance.view')
  customers(
    @Query({ schema: customerListQuery }) q: z.output<typeof customerListQuery>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.sales.customers(tenant, auth, q.q);
  }

  @Post('customers')
  @RequirePermission('finance.manage')
  createCustomer(
    @Body({ schema: customerSchema }) body: z.output<typeof customerSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.sales.createCustomer(tenant, auth, body, requestMeta(req));
  }

  @Put('customers/:id')
  @RequirePermission('finance.manage')
  updateCustomer(
    @Param('id', id()) customerId: string,
    @Body({ schema: updateCustomerSchema }) body: z.output<typeof updateCustomerSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.sales.updateCustomer(tenant, auth, customerId, body, requestMeta(req));
  }

  @Get('customers/:id/statement')
  @RequirePermission('finance.view')
  @ApiOperation({ summary: 'A customer’s statement with a running balance' })
  statement(
    @Param('id', id()) customerId: string,
    @Query({ schema: statementQuery }) q: z.output<typeof statementQuery>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.sales.statement(tenant, auth, customerId, q.companyId, q.from, q.to);
  }

  @Get('templates')
  @RequirePermission('finance.view')
  templates(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.sales.templates(tenant, auth);
  }

  @Post('templates')
  @RequirePermission('finance.manage')
  createTemplate(
    @Body({ schema: templateSchema }) body: z.output<typeof templateSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.sales.createTemplate(tenant, auth, body, requestMeta(req));
  }

  @Put('templates/:id')
  @RequirePermission('finance.manage')
  updateTemplate(
    @Param('id', id()) templateId: string,
    @Body({ schema: updateTemplateSchema }) body: z.output<typeof updateTemplateSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.sales.updateTemplate(tenant, auth, templateId, body, requestMeta(req));
  }

  @Post('templates/:id/default')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.manage')
  makeDefault(
    @Param('id', id()) templateId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.sales.makeDefaultTemplate(tenant, auth, templateId, requestMeta(req));
  }

  @Get('settings/:companyId')
  @RequirePermission('finance.view')
  settings(
    @Param('companyId', id()) companyId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.sales.settings(tenant, auth, companyId);
  }

  @Put('settings/:companyId')
  @RequirePermission('finance.configure')
  saveSettings(
    @Param('companyId', id()) companyId: string,
    @Body({ schema: salesSettingSchema }) body: z.output<typeof salesSettingSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.sales.saveSettings(tenant, auth, companyId, body, requestMeta(req));
  }

  @Get('documents')
  @RequirePermission('finance.view')
  documents(
    @Query({ schema: salesDocumentListSchema }) q: z.output<typeof salesDocumentListSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.sales.documents(tenant, auth, q);
  }

  @Post('documents')
  @RequirePermission('finance.manage')
  createDocument(
    @Body({ schema: salesDocumentSchema }) body: z.output<typeof salesDocumentSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.sales.createDocument(tenant, auth, body, requestMeta(req));
  }

  @Get('documents/:id')
  @RequirePermission('finance.view')
  document(
    @Param('id', id()) docId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.sales.document(tenant, auth, docId);
  }

  @Put('documents/:id')
  @RequirePermission('finance.manage')
  updateDocument(
    @Param('id', id()) docId: string,
    @Body({ schema: updateSalesDocumentSchema }) body: z.output<typeof updateSalesDocumentSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.sales.updateDocument(tenant, auth, docId, body, requestMeta(req));
  }

  @Post('documents/:id/issue')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.manage')
  @ApiOperation({ summary: 'Number a document; invoices and credit notes post to the books' })
  issue(
    @Param('id', id()) docId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.sales.issue(tenant, auth, docId, requestMeta(req));
  }

  @Post('documents/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('finance.manage')
  cancel(
    @Param('id', id()) docId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.sales.cancel(tenant, auth, docId, requestMeta(req));
  }

  @Post('documents/:id/invoice')
  @RequirePermission('finance.manage')
  @ApiOperation({ summary: 'Turn a quotation, proforma or challan into a draft invoice' })
  toInvoice(
    @Param('id', id()) docId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.sales.derive(tenant, auth, docId, 'INVOICE', requestMeta(req));
  }

  @Post('documents/:id/credit-note')
  @RequirePermission('finance.manage')
  @ApiOperation({ summary: 'Start a credit note against an issued invoice' })
  toCreditNote(
    @Param('id', id()) docId: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.sales.derive(tenant, auth, docId, 'CREDIT_NOTE', requestMeta(req));
  }

  @Get('receipts')
  @RequirePermission('finance.view')
  receipts(
    @Query({ schema: receiptListQuery }) q: z.output<typeof receiptListQuery>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.sales.receipts(tenant, auth, q.companyId, q.customerId);
  }

  @Post('receipts')
  @RequirePermission('finance.manage')
  @ApiOperation({ summary: 'Record money received; settles invoices and posts to the books' })
  recordReceipt(
    @Body({ schema: receiptSchema }) body: z.output<typeof receiptSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.sales.recordReceipt(tenant, auth, body, requestMeta(req));
  }

  @Get('summary')
  @RequirePermission('finance.view')
  summary(
    @Query({ schema: salesCompanyQuerySchema }) q: z.output<typeof salesCompanyQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.sales.summary(tenant, auth, q.companyId);
  }

  @Get('ageing')
  @RequirePermission('finance.view')
  ageing(
    @Query({ schema: salesAgeingQuerySchema }) q: z.output<typeof salesAgeingQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.sales.ageing(tenant, auth, q.companyId, q.asOf);
  }
}
