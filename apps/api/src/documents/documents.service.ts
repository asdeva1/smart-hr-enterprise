import { Inject, Injectable } from '@nestjs/common';
import {
  withContext,
  type DatabaseClient,
  type EmployeeDocument,
  type Prisma,
  type StoredFile,
  type TenantTransaction,
} from '@smart-hr/database';
import { AppError, ForbiddenError, NotFoundError } from '@smart-hr/shared';
import {
  DOCUMENT_CATEGORY_LABEL,
  fillPlaceholders,
  type documentListQuerySchema,
  type generateLetterSchema,
  type LetterPlaceholder,
  type letterTemplateSchema,
  type updateDocumentSchema,
  type updateLetterTemplateSchema,
  type uploadDocumentSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import type { ApiEnv } from '../config/env.js';
import { displayName, toDate } from '../employees/employees.service.js';
import { OrgIndex } from '../employees/org-index.js';
import { API_ENV, DATABASE } from '../infra/tokens.js';
import { ALLOWED_FILE_LABELS, cleanFileName, detectFileKind } from './file-types.js';
import { FilesService } from './files.service.js';
import { renderLetterPdf } from './pdf.js';

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

const DOC_EMPLOYEE = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  preferredName: true,
  membershipId: true,
  companyId: true,
  branchId: true,
  departmentId: true,
  status: true,
} satisfies Prisma.EmployeeSelect;
type DocEmployee = Prisma.EmployeeGetPayload<{ select: typeof DOC_EMPLOYEE }>;

const DOC_INCLUDE = {
  file: { select: { fileName: true, mimeType: true, sizeBytes: true, sha256: true } },
  employee: { select: DOC_EMPLOYEE },
  signatures: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { id: true, status: true, signedFileId: true },
  },
} satisfies Prisma.EmployeeDocumentInclude;
type DocRow = Prisma.EmployeeDocumentGetPayload<{ include: typeof DOC_INCLUDE }>;

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export interface DocumentAccess {
  employee: DocEmployee;
  self: boolean;
  view: boolean;
  manage: boolean;
}

/**
 * Documents on employee records. HR sees and manages documents with documents.view / documents.manage
 * where the employee sits; employees see their own documents that are shared with them and may add their
 * own (certificates, ID copies). Managers don't see their reports' documents unless granted. Every
 * download is audited.
 */
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  run<T>(tenant: TenantContext, auth: AuthContext, work: (tx: TenantTransaction) => Promise<T>) {
    return withContext(this.db, { tenantId: tenant.id, userId: auth.user.id }, work);
  }

  // ---- Access -----------------------------------------------------------------------------------

  /** What the member may do with an employee's documents; 404 when they may do nothing. */
  async access(tx: TenantTransaction, tenant: TenantContext, employeeId: string): Promise<DocumentAccess> {
    const employee = await tx.employee.findUnique({ where: { id: employeeId }, select: DOC_EMPLOYEE });
    if (!employee) throw new NotFoundError('Employee');
    const org = await OrgIndex.load(tx, tenant.id);
    const scopes = org.scopesOf(employee);
    const access = {
      employee,
      self: employee.membershipId === tenant.membershipId,
      view: tenant.permissions.allows('documents.view', scopes),
      manage: tenant.permissions.allows('documents.manage', scopes),
    };
    if (!access.self && !access.view && !access.manage) throw new NotFoundError('Employee');
    return access;
  }

  /** Whether the member may see this document (and its file). */
  canSee(access: DocumentAccess, doc: Pick<EmployeeDocument, 'visibleToEmployee' | 'status'>): boolean {
    if (access.view || access.manage) return true;
    return access.self && doc.visibleToEmployee && doc.status === 'ACTIVE';
  }

  private present(row: DocRow, access: DocumentAccess) {
    const sig = row.signatures[0] ?? null;
    return {
      id: row.id,
      employee: {
        id: row.employee.id,
        name: displayName(row.employee),
        employeeCode: row.employee.employeeCode,
      },
      title: row.title,
      category: row.category,
      categoryLabel: DOCUMENT_CATEGORY_LABEL[row.category],
      notes: access.view || access.manage ? row.notes : null,
      visibleToEmployee: row.visibleToEmployee,
      expiresOn: iso(row.expiresOn),
      status: row.status,
      file: {
        name: row.file.fileName,
        mimeType: row.file.mimeType,
        size: row.file.sizeBytes,
        sha256: row.file.sha256,
      },
      signature: sig && { id: sig.id, status: sig.status },
      uploadedByUserId: row.uploadedByUserId,
      createdAt: row.createdAt,
      archivedAt: row.archivedAt,
      can: {
        manage: access.manage,
        sendForSignature: access.manage && row.status === 'ACTIVE' && row.file.mimeType === 'application/pdf',
      },
    };
  }

  // ---- Reading ----------------------------------------------------------------------------------

  async list(
    tenant: TenantContext,
    auth: AuthContext,
    employeeId: string,
    q: z.output<typeof documentListQuerySchema>,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const access = await this.access(tx, tenant, employeeId);
      const staff = access.view || access.manage;
      const rows = await tx.employeeDocument.findMany({
        where: {
          employeeId,
          ...(staff
            ? q.status === 'ALL'
              ? {}
              : { status: q.status }
            : { status: 'ACTIVE', visibleToEmployee: true }),
        },
        include: DOC_INCLUDE,
        orderBy: [{ createdAt: 'desc' }],
        take: 200,
      });
      return {
        employee: { id: access.employee.id, name: displayName(access.employee) },
        can: { manage: access.manage, upload: access.manage || access.self },
        items: rows.map((r) => this.present(r, access)),
      };
    });
  }

  /** My own record's documents, or nothing when the account has no employee record. */
  async mine(tenant: TenantContext, auth: AuthContext) {
    const me = await this.run(tenant, auth, (tx) =>
      tx.employee.findFirst({ where: { membershipId: tenant.membershipId }, select: { id: true } }),
    );
    if (!me) return { employee: null, can: { manage: false, upload: false }, items: [] };
    return this.list(tenant, auth, me.id, { status: 'ACTIVE' });
  }

  async loadDocument(tx: TenantTransaction, tenant: TenantContext, id: string) {
    const doc = await tx.employeeDocument.findUnique({ where: { id }, include: DOC_INCLUDE });
    if (!doc) throw new NotFoundError('Document');
    let access: DocumentAccess;
    try {
      access = await this.access(tx, tenant, doc.employeeId);
    } catch {
      throw new NotFoundError('Document');
    }
    if (!this.canSee(access, doc)) throw new NotFoundError('Document');
    return { doc, access };
  }

  async get(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.run(tenant, auth, async (tx) => {
      const { doc, access } = await this.loadDocument(tx, tenant, id);
      return this.present(doc, access);
    });
  }

  /** The file, decrypted and checked, for a download. */
  async download(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const { doc } = await this.loadDocument(tx, tenant, id);
      const file = await tx.storedFile.findUniqueOrThrow({ where: { id: doc.fileId } });
      return this.readFile(tx, tenant, auth, file, { documentId: doc.id }, meta);
    });
  }

  /** Reads a stored file and records who downloaded it. */
  async readFile(
    tx: TenantTransaction,
    tenant: TenantContext,
    auth: AuthContext,
    file: StoredFile,
    context: Record<string, string>,
    meta: RequestMeta,
  ) {
    const data = await this.files.read(file);
    await this.audit.recordInTransaction(
      tx,
      {
        action: 'document.download',
        outcome: 'SUCCESS',
        tenantId: tenant.id,
        actorUserId: auth.user.id,
        targetType: 'stored_file',
        targetId: file.id,
        metadata: context,
      },
      meta,
    );
    return { data, fileName: file.fileName, mimeType: file.mimeType };
  }

  /** Documents expiring within `days` (or already expired) that the member may see, soonest first. */
  async expiring(tenant: TenantContext, auth: AuthContext, days: number) {
    return this.run(tenant, auth, async (tx) => {
      const org = await OrgIndex.load(tx, tenant.id);
      const visible = org.visibilityFilter(tenant.permissions, 'documents.view');
      if (visible && visible.OR.length === 0) throw new ForbiddenError();
      const until = new Date(Date.now() + days * 86_400_000);
      const rows = await tx.employeeDocument.findMany({
        where: {
          status: 'ACTIVE',
          expiresOn: { not: null, lte: until },
          ...(visible ? { employee: visible } : {}),
        },
        include: DOC_INCLUDE,
        orderBy: [{ expiresOn: 'asc' }],
        take: 200,
      });
      return rows.map((r) =>
        this.present(r, {
          employee: r.employee,
          self: r.employee.membershipId === tenant.membershipId,
          view: true,
          manage: tenant.permissions.allows('documents.manage', org.scopesOf(r.employee)),
        }),
      );
    });
  }

  // ---- Writing ----------------------------------------------------------------------------------

  async upload(
    tenant: TenantContext,
    auth: AuthContext,
    employeeId: string,
    file: UploadedFile | undefined,
    input: z.output<typeof uploadDocumentSchema>,
    meta: RequestMeta,
  ) {
    if (!file || file.size === 0) throw new AppError('FILE_REQUIRED', 'Choose a file to upload', 400);
    const fileName = cleanFileName(file.originalname);
    const kind = detectFileKind(file.buffer, fileName);
    if (!kind) {
      throw new AppError(
        'FILE_TYPE_NOT_ALLOWED',
        `This file type can’t be uploaded. Use ${ALLOWED_FILE_LABELS}, with the matching extension.`,
        400,
      );
    }
    return this.run(tenant, auth, async (tx) => {
      const access = await this.access(tx, tenant, employeeId);
      if (!access.manage && !access.self) throw new ForbiddenError();
      const stored = await this.files.store(tx, tenant.id, {
        data: file.buffer,
        fileName,
        mimeType: kind.mimeType,
        uploadedByUserId: auth.user.id,
      });
      const doc = await tx.employeeDocument.create({
        data: {
          tenantId: tenant.id,
          employeeId,
          fileId: stored.id,
          title: input.title,
          category: input.category,
          notes: access.manage ? (input.notes ?? null) : null,
          // Someone adding to their own record can't hide it from themselves.
          visibleToEmployee: access.manage ? input.visibleToEmployee : true,
          expiresOn: input.expiresOn ? toDate(input.expiresOn) : null,
          uploadedByUserId: auth.user.id,
        },
        include: DOC_INCLUDE,
      });
      await this.record(tx, tenant, auth, 'document.upload', doc, meta, {
        fileName,
        size: String(stored.sizeBytes),
        sha256: stored.sha256,
      });
      return this.present(doc, access);
    });
  }

  async update(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateDocumentSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const { doc, access } = await this.loadDocument(tx, tenant, id);
      if (!access.manage) throw new ForbiddenError();
      if (doc.status !== 'ACTIVE')
        throw new AppError('DOCUMENT_ARCHIVED', 'Archived documents can’t be changed', 409);
      const expiresOn =
        input.expiresOn === undefined ? undefined : input.expiresOn ? toDate(input.expiresOn) : null;
      const updated = await tx.employeeDocument.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.visibleToEmployee !== undefined ? { visibleToEmployee: input.visibleToEmployee } : {}),
          // A new expiry date gets its own reminder.
          ...(expiresOn !== undefined ? { expiresOn, expiryNotifiedAt: null } : {}),
        },
        include: DOC_INCLUDE,
      });
      await this.record(tx, tenant, auth, 'document.update', updated, meta, {
        fields: Object.keys(input)
          .filter((k) => input[k as keyof typeof input] !== undefined)
          .join(','),
      });
      return this.present(updated, access);
    });
  }

  async archive(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.run(tenant, auth, async (tx) => {
      const { doc, access } = await this.loadDocument(tx, tenant, id);
      if (!access.manage) throw new ForbiddenError();
      if (doc.status !== 'ACTIVE')
        throw new AppError('DOCUMENT_ARCHIVED', 'This document is already archived', 409);
      const open = await tx.signatureRequest.count({ where: { documentId: id, status: 'PENDING' } });
      if (open) {
        throw new AppError(
          'SIGNATURE_PENDING',
          'This document is out for signature. Cancel the signature request before archiving it.',
          409,
        );
      }
      const updated = await tx.employeeDocument.update({
        where: { id },
        data: { status: 'ARCHIVED', archivedAt: new Date(), archivedByUserId: auth.user.id },
        include: DOC_INCLUDE,
      });
      await this.record(tx, tenant, auth, 'document.archive', updated, meta);
      return this.present(updated, access);
    });
  }

  private async record(
    tx: TenantTransaction,
    tenant: TenantContext,
    auth: AuthContext,
    action: string,
    doc: EmployeeDocument,
    meta: RequestMeta,
    extra: Record<string, string> = {},
  ) {
    await this.audit.recordInTransaction(
      tx,
      {
        action,
        outcome: 'SUCCESS',
        tenantId: tenant.id,
        actorUserId: auth.user.id,
        targetType: 'employee_document',
        targetId: doc.id,
        metadata: { employeeId: doc.employeeId, category: doc.category, ...extra },
      },
      meta,
    );
  }

  // ---- Letter templates --------------------------------------------------------------------------

  async templates(tenant: TenantContext, auth: AuthContext, includeArchived: boolean) {
    return this.run(tenant, auth, async (tx) => {
      if (
        !tenant.permissions.hasAnywhere('documents.manage') &&
        !tenant.permissions.hasAnywhere('documents.configure')
      )
        throw new ForbiddenError();
      return tx.letterTemplate.findMany({
        where: includeArchived ? {} : { status: 'ACTIVE' },
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
      });
    });
  }

  private assertConfigure(tenant: TenantContext) {
    if (!tenant.permissions.hasAnywhere('documents.configure')) throw new ForbiddenError();
  }

  async createTemplate(
    tenant: TenantContext,
    auth: AuthContext,
    input: z.output<typeof letterTemplateSchema>,
    meta: RequestMeta,
  ) {
    this.assertConfigure(tenant);
    return this.run(tenant, auth, async (tx) => {
      await this.assertNameFree(tx, input.name);
      const t = await tx.letterTemplate.create({ data: { tenantId: tenant.id, ...input } });
      await this.recordTemplate(tx, tenant, auth, 'letter_template.create', t.id, meta);
      return t;
    });
  }

  async updateTemplate(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof updateLetterTemplateSchema>,
    meta: RequestMeta,
  ) {
    this.assertConfigure(tenant);
    return this.run(tenant, auth, async (tx) => {
      const t = await tx.letterTemplate.findUnique({ where: { id } });
      if (!t) throw new NotFoundError('Template');
      if (input.name !== undefined && input.name !== t.name) await this.assertNameFree(tx, input.name);
      const updated = await tx.letterTemplate.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      await this.recordTemplate(tx, tenant, auth, 'letter_template.update', id, meta);
      return updated;
    });
  }

  private async assertNameFree(tx: TenantTransaction, name: string) {
    const clash = await tx.letterTemplate.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (clash)
      throw new AppError('NAME_TAKEN', 'A template with this name already exists', 409, [
        { path: 'name', message: 'Already used' },
      ]);
  }

  private async recordTemplate(
    tx: TenantTransaction,
    tenant: TenantContext,
    auth: AuthContext,
    action: string,
    id: string,
    meta: RequestMeta,
  ) {
    await this.audit.recordInTransaction(
      tx,
      {
        action,
        outcome: 'SUCCESS',
        tenantId: tenant.id,
        actorUserId: auth.user.id,
        targetType: 'letter_template',
        targetId: id,
      },
      meta,
    );
  }

  /** The values a letter for this employee would be filled with. */
  private async letterValues(tx: TenantTransaction, tenantId: string, employeeId: string) {
    const e = await tx.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: {
        firstName: true,
        lastName: true,
        preferredName: true,
        employeeCode: true,
        workEmail: true,
        dateOfJoining: true,
        designation: { select: { name: true } },
        department: { select: { name: true } },
        branch: { select: { name: true } },
        company: { select: { name: true, legalName: true } },
        manager: { select: { firstName: true, lastName: true, preferredName: true } },
      },
    });
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { name: true, brandName: true },
    });
    const long = (d: Date) =>
      d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    const values: Record<LetterPlaceholder, string> = {
      'employee.name': displayName(e),
      'employee.firstName': e.firstName,
      'employee.lastName': e.lastName,
      'employee.code': e.employeeCode,
      'employee.designation': e.designation?.name ?? '',
      'employee.department': e.department?.name ?? '',
      'employee.branch': e.branch?.name ?? '',
      'employee.company': e.company.legalName ?? e.company.name,
      'employee.joinDate': long(e.dateOfJoining),
      'employee.workEmail': e.workEmail ?? '',
      'employee.manager': e.manager ? displayName(e.manager) : '',
      'organisation.name': tenant.brandName ?? tenant.name,
      today: long(new Date()),
    };
    return values;
  }

  /** The filled-in text, to check before making the letter. */
  async previewLetter(tenant: TenantContext, auth: AuthContext, employeeId: string, templateId: string) {
    return this.run(tenant, auth, async (tx) => {
      const access = await this.access(tx, tenant, employeeId);
      if (!access.manage) throw new ForbiddenError();
      const t = await tx.letterTemplate.findFirst({ where: { id: templateId, status: 'ACTIVE' } });
      if (!t) throw new NotFoundError('Template');
      return {
        title: t.name,
        body: fillPlaceholders(t.body, await this.letterValues(tx, tenant.id, employeeId)),
      };
    });
  }

  /** Makes a PDF letter from a template and adds it to the employee's documents. */
  async generateLetter(
    tenant: TenantContext,
    auth: AuthContext,
    employeeId: string,
    input: z.output<typeof generateLetterSchema>,
    meta: RequestMeta,
  ) {
    return this.run(tenant, auth, async (tx) => {
      const access = await this.access(tx, tenant, employeeId);
      if (!access.manage) throw new ForbiddenError();
      const t = await tx.letterTemplate.findFirst({ where: { id: input.templateId, status: 'ACTIVE' } });
      if (!t) throw new NotFoundError('Template');
      const values = await this.letterValues(tx, tenant.id, employeeId);
      const title = input.title ?? `${t.name} – ${values['employee.name']}`;
      const pdf = await renderLetterPdf({
        organisation: values['organisation.name'],
        title,
        body: fillPlaceholders(t.body, values),
        footer: `${values['organisation.name']} · ${values['employee.code']} · ${values.today}`,
      });
      const stored = await this.files.store(tx, tenant.id, {
        data: pdf,
        fileName: cleanFileName(`${title}.pdf`),
        mimeType: 'application/pdf',
        uploadedByUserId: auth.user.id,
      });
      const doc = await tx.employeeDocument.create({
        data: {
          tenantId: tenant.id,
          employeeId,
          fileId: stored.id,
          title,
          category: t.category,
          visibleToEmployee: input.visibleToEmployee,
          uploadedByUserId: auth.user.id,
        },
        include: DOC_INCLUDE,
      });
      await this.record(tx, tenant, auth, 'document.letter', doc, meta, {
        templateId: t.id,
        sha256: stored.sha256,
      });
      return this.present(doc, access);
    });
  }

  /** Maximum upload size in bytes (also enforced by the upload parser). */
  get maxUploadBytes() {
    return this.env.DOCUMENT_MAX_UPLOAD_MB * 1024 * 1024;
  }
}
