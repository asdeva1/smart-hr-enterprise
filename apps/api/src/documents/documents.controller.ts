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
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  declineSchema,
  documentListQuerySchema,
  expiringQuerySchema,
  generateLetterSchema,
  letterTemplateSchema,
  signatureListQuerySchema,
  signatureRequestSchema,
  signSchema,
  updateDocumentSchema,
  updateLetterTemplateSchema,
  uploadDocumentSchema,
} from '@smart-hr/validation';
import type { Response } from 'express';
import { z } from 'zod';
import {
  CurrentAuth,
  CurrentTenant,
  RequireFeature,
  RequirePermission,
  RequireRecentAuth,
} from '../auth/auth.decorators.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import { requestMeta, type AppRequest } from '../common/request-context.js';
import { DocumentsService, type UploadedFile as Upload } from './documents.service.js';
import { contentDisposition } from './file-types.js';
import { SignaturesService } from './signatures.service.js';

const previewQuerySchema = z.object({ templateId: z.uuid() });
const templatesQuerySchema = z.object({ archived: z.stringbool().default(false) });
const peopleQuerySchema = z.object({ search: z.string().trim().max(100).optional() });

/** Sends a decrypted file: always as a download, never cached, never run as a page. */
function send(res: Response, file: { data: Buffer; fileName: string; mimeType: string }) {
  res.set({
    'Cache-Control': 'private, no-store',
    // No `sandbox`: Chromium then drops the download's file name. `attachment` and nosniff already stop the
    // browser rendering the file, and this policy stops anything in it loading or running if it ever did.
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
  });
  return new StreamableFile(file.data, {
    type: file.mimeType,
    disposition: contentDisposition(file.fileName),
    length: file.data.length,
  });
}

@ApiTags('documents')
@RequireFeature('documents')
@Controller('v1/documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly signatures: SignaturesService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Documents on my own employee record that are shared with me' })
  mine(@CurrentTenant() tenant: TenantContext, @CurrentAuth() auth: AuthContext) {
    return this.documents.mine(tenant, auth);
  }

  @Get('expiring')
  @RequirePermission('documents.view')
  @ApiOperation({ summary: 'Documents expiring within a number of days (or expired), soonest first' })
  expiring(
    @Query({ schema: expiringQuerySchema }) q: z.output<typeof expiringQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.documents.expiring(tenant, auth, q.days);
  }

  @Get('templates')
  @ApiOperation({ summary: 'Letter templates' })
  templates(
    @Query({ schema: templatesQuerySchema }) q: z.output<typeof templatesQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.documents.templates(tenant, auth, q.archived);
  }

  @Post('templates')
  @RequirePermission('documents.configure')
  @ApiOperation({ summary: 'Add a letter template' })
  createTemplate(
    @Body({ schema: letterTemplateSchema }) body: z.output<typeof letterTemplateSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.documents.createTemplate(tenant, auth, body, requestMeta(req));
  }

  @Patch('templates/:id')
  @RequirePermission('documents.configure')
  @ApiOperation({ summary: 'Change or archive a letter template' })
  updateTemplate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: updateLetterTemplateSchema }) body: z.output<typeof updateLetterTemplateSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.documents.updateTemplate(tenant, auth, id, body, requestMeta(req));
  }

  @Get('employee/:employeeId')
  @ApiOperation({ summary: 'An employee’s documents (HR, or the employee for what is shared with them)' })
  list(
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Query({ schema: documentListQuerySchema }) q: z.output<typeof documentListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.documents.list(tenant, auth, employeeId, q);
  }

  @Post('employee/:employeeId')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a document to an employee’s record (field "file" plus details)' })
  upload(
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @UploadedFile() file: Upload | undefined,
    @Body({ schema: uploadDocumentSchema }) body: z.output<typeof uploadDocumentSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.documents.upload(tenant, auth, employeeId, file, body, requestMeta(req));
  }

  @Get('employee/:employeeId/letters/preview')
  @RequirePermission('documents.manage')
  @ApiOperation({ summary: 'A template filled in for this employee, to check before making the letter' })
  preview(
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Query({ schema: previewQuerySchema }) q: z.output<typeof previewQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.documents.previewLetter(tenant, auth, employeeId, q.templateId);
  }

  @Post('employee/:employeeId/letters')
  @RequirePermission('documents.manage')
  @ApiOperation({ summary: 'Make a PDF letter from a template and add it to the employee’s documents' })
  generate(
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Body({ schema: generateLetterSchema }) body: z.output<typeof generateLetterSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.documents.generateLetter(tenant, auth, employeeId, body, requestMeta(req));
  }

  @Get(':id')
  @ApiOperation({ summary: 'One document' })
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.documents.get(tenant, auth, id);
  }

  @Get(':id/file')
  @ApiOperation({ summary: 'Download a document (audited)' })
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(res, await this.documents.download(tenant, auth, id, requestMeta(req)));
  }

  @Patch(':id')
  @RequirePermission('documents.manage')
  @ApiOperation({ summary: 'Change a document’s details (not its file)' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: updateDocumentSchema }) body: z.output<typeof updateDocumentSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.documents.update(tenant, auth, id, body, requestMeta(req));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('documents.manage')
  @ApiOperation({ summary: 'Archive a document (kept, but no longer current)' })
  archive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.documents.archive(tenant, auth, id, requestMeta(req));
  }

  @Post(':id/signatures')
  @RequireFeature('esignature')
  @RequirePermission('documents.manage')
  @ApiOperation({ summary: 'Send a PDF document for signature' })
  requestSignatures(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: signatureRequestSchema }) body: z.output<typeof signatureRequestSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.signatures.create(tenant, auth, id, body, requestMeta(req));
  }
}

@ApiTags('documents')
@RequireFeature('esignature')
@Controller('v1/signatures')
export class SignaturesController {
  constructor(private readonly signatures: SignaturesService) {}

  @Get()
  @ApiOperation({ summary: 'Signature requests: waiting for me (mine), sent by me, or all I may see' })
  list(
    @Query({ schema: signatureListQuerySchema }) q: z.output<typeof signatureListQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.signatures.list(tenant, auth, q);
  }

  @Get('people')
  @RequirePermission('documents.manage')
  @ApiOperation({ summary: 'Members who can be asked to sign' })
  people(
    @Query({ schema: peopleQuerySchema }) q: z.output<typeof peopleQuerySchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.signatures.people(tenant, auth, q.search);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One signature request with its signers' })
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.signatures.get(tenant, auth, id);
  }

  @Get(':id/document')
  @ApiOperation({ summary: 'The document as sent for signature (audited)' })
  async document(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(res, await this.signatures.file(tenant, auth, id, 'document', requestMeta(req)));
  }

  @Get(':id/signed')
  @ApiOperation({ summary: 'The signed copy with its signature certificate (audited)' })
  async signed(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(res, await this.signatures.file(tenant, auth, id, 'signed', requestMeta(req)));
  }

  @Post(':id/sign')
  @HttpCode(HttpStatus.OK)
  @RequireRecentAuth()
  @ApiOperation({ summary: 'Sign (recent password entry; typed name and consent)' })
  sign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: signSchema }) body: z.output<typeof signSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.signatures.sign(tenant, auth, id, body, requestMeta(req));
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline to sign, with a reason' })
  decline(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body({ schema: declineSchema }) body: z.output<typeof declineSchema>,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.signatures.decline(tenant, auth, id, body, requestMeta(req));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a signature request (its sender, or HR)' })
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    return this.signatures.cancel(tenant, auth, id, requestMeta(req));
  }
}
