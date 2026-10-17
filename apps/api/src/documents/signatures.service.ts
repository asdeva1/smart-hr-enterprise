import { Inject, Injectable } from '@nestjs/common';
import { createNotifications, type Prisma, type TenantTransaction } from '@smart-hr/database';
import { AppError, ForbiddenError, NOTIFICATION_CATEGORIES, NotFoundError } from '@smart-hr/shared';
import type {
  declineSchema,
  signatureListQuerySchema,
  signatureRequestSchema,
  signSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext, TenantContext } from '../auth/auth.types.js';
import type { RequestMeta } from '../common/request-context.js';
import type { ApiEnv } from '../config/env.js';
import { displayName } from '../employees/employees.service.js';
import { OrgIndex } from '../employees/org-index.js';
import { API_ENV } from '../infra/tokens.js';
import { DocumentsService } from './documents.service.js';
import { cleanFileName } from './file-types.js';
import { FilesService, sha256 } from './files.service.js';
import { appendCertificate, isEditablePdf } from './pdf.js';

const REQUEST_INCLUDE = {
  signers: { orderBy: { position: 'asc' as const } },
  document: {
    select: {
      id: true,
      title: true,
      employeeId: true,
      fileId: true,
      visibleToEmployee: true,
      category: true,
      employee: {
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          companyId: true,
          branchId: true,
          departmentId: true,
        },
      },
    },
  },
} satisfies Prisma.SignatureRequestInclude;
type RequestRow = Prisma.SignatureRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

const link = (id: string) => `/documents/signatures/${id}`;

/**
 * Electronic signatures on PDF documents. Signers are members of the organisation, signed in; each confirms
 * they have read the document and types their name. The document's SHA-256 is fixed when it is sent and
 * checked before every signature, so nobody signs something other than what was sent. When everyone has
 * signed, the signed copy (the original plus a signature certificate) is added to the employee's documents.
 */
@Injectable()
export class SignaturesService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly documents: DocumentsService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  private present(r: RequestRow, tenant: TenantContext, auth: AuthContext, staff: boolean) {
    const me = r.signers.find((s) => s.membershipId === tenant.membershipId) ?? null;
    const requester = r.requestedByUserId === auth.user.id;
    return {
      id: r.id,
      title: r.title,
      message: r.message,
      status: r.status,
      sequential: r.sequential,
      documentSha256: r.documentSha256,
      document: { id: r.document.id, title: r.document.title },
      employee: {
        id: r.document.employee.id,
        name: displayName(r.document.employee),
        employeeCode: r.document.employee.employeeCode,
      },
      signers: r.signers.map((s) => ({
        id: s.id,
        position: s.position,
        name: s.name,
        email: s.email,
        status: s.status,
        signedName: s.signedName,
        signedAt: s.signedAt,
        declinedAt: s.declinedAt,
        declineReason: s.declineReason,
      })),
      requestedByUserId: r.requestedByUserId,
      expiresAt: r.expiresAt,
      completedAt: r.completedAt,
      closedAt: r.closedAt,
      createdAt: r.createdAt,
      hasSignedCopy: !!r.signedFileId,
      me: me && { signerId: me.id, status: me.status },
      can: {
        sign: r.status === 'PENDING' && me?.status === 'PENDING',
        cancel: r.status === 'PENDING' && (requester || staff),
      },
    };
  }

  /** The request if the member is its sender, one of its signers, or sees the employee's documents. */
  private async load(tx: TenantTransaction, tenant: TenantContext, auth: AuthContext, id: string) {
    const r = await tx.signatureRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE });
    if (!r) throw new NotFoundError('Signature request');
    const org = await OrgIndex.load(tx, tenant.id);
    const scopes = org.scopesOf(r.document.employee);
    const staffView = tenant.permissions.allows('documents.view', scopes);
    const staffManage = tenant.permissions.allows('documents.manage', scopes);
    const involved =
      r.requestedByUserId === auth.user.id || r.signers.some((s) => s.membershipId === tenant.membershipId);
    if (!involved && !staffView && !staffManage) throw new NotFoundError('Signature request');
    return { r, staff: staffManage };
  }

  private async notify(
    tx: TenantTransaction,
    tenantId: string,
    userIds: string[],
    requestId: string,
    title: string,
    body: string,
  ) {
    const target = link(requestId);
    await createNotifications(tx, tenantId, {
      recipientUserIds: userIds,
      category: 'document.signature',
      emailDefault: NOTIFICATION_CATEGORIES['document.signature'].emailDefault,
      title,
      body,
      link: target,
      email: { subject: title, text: `${body}\n\n${new URL(target, this.env.APP_PUBLIC_URL).toString()}` },
    });
  }

  private async record(
    tx: TenantTransaction,
    tenant: TenantContext,
    auth: AuthContext,
    action: string,
    id: string,
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
        targetType: 'signature_request',
        targetId: id,
        metadata: extra,
      },
      meta,
    );
  }

  private lock(tx: TenantTransaction, key: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`signature:${key}`}))`;
  }

  // ---- Sending ----------------------------------------------------------------------------------

  async create(
    tenant: TenantContext,
    auth: AuthContext,
    documentId: string,
    input: z.output<typeof signatureRequestSchema>,
    meta: RequestMeta,
  ) {
    return this.documents.run(tenant, auth, async (tx) => {
      const { doc, access } = await this.documents.loadDocument(tx, tenant, documentId);
      if (!access.manage) throw new ForbiddenError();
      if (doc.status !== 'ACTIVE')
        throw new AppError('DOCUMENT_ARCHIVED', 'Archived documents can’t be sent for signature', 409);
      if (doc.file.mimeType !== 'application/pdf') {
        throw new AppError('SIGNATURE_NEEDS_PDF', 'Only PDF documents can be sent for signature', 400);
      }
      await this.lock(tx, `document:${documentId}`);
      const open = await tx.signatureRequest.count({ where: { documentId, status: 'PENDING' } });
      if (open) {
        throw new AppError('SIGNATURE_PENDING', 'This document is already out for signature', 409);
      }
      const file = await tx.storedFile.findUniqueOrThrow({ where: { id: doc.fileId } });
      const data = await this.files.read(file);
      if (!(await isEditablePdf(data))) {
        throw new AppError(
          'PDF_NOT_SIGNABLE',
          'This PDF is protected or damaged, so a signature certificate can’t be added to it. Upload an unprotected copy.',
          400,
        );
      }
      const memberships = await tx.tenantMembership.findMany({
        where: { id: { in: input.signerMembershipIds }, status: 'ACTIVE' },
        select: {
          id: true,
          userId: true,
          user: { select: { displayName: true, email: true, status: true } },
        },
      });
      const byId = new Map(memberships.filter((m) => m.user.status === 'ACTIVE').map((m) => [m.id, m]));
      const missing = input.signerMembershipIds.filter((id) => !byId.has(id));
      if (missing.length) {
        throw new AppError(
          'SIGNER_NOT_AVAILABLE',
          'Every signer must be an active member of the organisation',
          400,
          [{ path: 'signerMembershipIds', message: 'Not an active member' }],
        );
      }
      const request = await tx.signatureRequest.create({
        data: {
          tenantId: tenant.id,
          documentId,
          title: input.title ?? doc.title,
          message: input.message ?? null,
          sequential: input.sequential,
          documentSha256: file.sha256,
          requestedByUserId: auth.user.id,
          expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null,
          signers: {
            create: input.signerMembershipIds.map((membershipId, i) => {
              const m = byId.get(membershipId)!;
              return {
                position: i + 1,
                membershipId,
                userId: m.userId,
                name: m.user.displayName,
                email: m.user.email,
                status: !input.sequential || i === 0 ? ('PENDING' as const) : ('WAITING' as const),
              };
            }),
          },
        },
        include: REQUEST_INCLUDE,
      });
      await this.notify(
        tx,
        tenant.id,
        request.signers.filter((s) => s.status === 'PENDING').map((s) => s.userId),
        request.id,
        `Please sign: ${request.title}`,
        `${auth.user.displayName} asked you to sign “${request.title}”.${request.message ? `\n\n${request.message}` : ''}`,
      );
      await this.record(tx, tenant, auth, 'signature.request', request.id, meta, {
        documentId,
        signers: String(request.signers.length),
        sha256: file.sha256,
      });
      return this.present(request, tenant, auth, true);
    });
  }

  // ---- Reading ----------------------------------------------------------------------------------

  /** Active members who can be asked to sign, for whoever sends documents. */
  async people(tenant: TenantContext, auth: AuthContext, search: string | undefined) {
    if (!tenant.permissions.hasAnywhere('documents.manage')) throw new ForbiddenError();
    return this.documents.run(tenant, auth, async (tx) => {
      const terms = (search ?? '').split(/\s+/).filter(Boolean).slice(0, 4);
      const rows = await tx.tenantMembership.findMany({
        where: {
          status: 'ACTIVE',
          user: {
            status: 'ACTIVE',
            AND: terms.map((t) => ({
              OR: [
                { displayName: { contains: t, mode: 'insensitive' as const } },
                { email: { contains: t, mode: 'insensitive' as const } },
              ],
            })),
          },
        },
        select: { id: true, user: { select: { displayName: true, email: true } } },
        orderBy: { user: { displayName: 'asc' } },
        take: 25,
      });
      return rows.map((m) => ({ membershipId: m.id, name: m.user.displayName, email: m.user.email }));
    });
  }

  async get(tenant: TenantContext, auth: AuthContext, id: string) {
    return this.documents.run(tenant, auth, async (tx) => {
      const { r, staff } = await this.load(tx, tenant, auth, id);
      return this.present(r, tenant, auth, staff);
    });
  }

  async list(tenant: TenantContext, auth: AuthContext, q: z.output<typeof signatureListQuerySchema>) {
    return this.documents.run(tenant, auth, async (tx) => {
      let where: Prisma.SignatureRequestWhereInput;
      if (q.scope === 'mine') where = { signers: { some: { membershipId: tenant.membershipId } } };
      else if (q.scope === 'sent') where = { requestedByUserId: auth.user.id };
      else {
        const org = await OrgIndex.load(tx, tenant.id);
        const visible = org.visibilityFilter(tenant.permissions, 'documents.view');
        if (visible && visible.OR.length === 0) throw new ForbiddenError();
        where = visible ? { document: { employee: visible } } : {};
      }
      const rows = await tx.signatureRequest.findMany({
        where: { AND: [where, ...(q.status ? [{ status: q.status }] : [])] },
        include: REQUEST_INCLUDE,
        orderBy: [{ createdAt: 'desc' }],
        take: 200,
      });
      return rows.map((r) => this.present(r, tenant, auth, false));
    });
  }

  /** The document as sent (for signers, the sender and HR), or the signed copy once complete. */
  async file(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    which: 'document' | 'signed',
    meta: RequestMeta,
  ) {
    return this.documents.run(tenant, auth, async (tx) => {
      const { r } = await this.load(tx, tenant, auth, id);
      const fileId = which === 'signed' ? r.signedFileId : r.document.fileId;
      if (!fileId) throw new NotFoundError('Signed copy');
      const file = await tx.storedFile.findUniqueOrThrow({ where: { id: fileId } });
      return this.documents.readFile(tx, tenant, auth, file, { signatureRequestId: r.id, which }, meta);
    });
  }

  // ---- Signing ----------------------------------------------------------------------------------

  private async mySigner(tx: TenantTransaction, tenant: TenantContext, auth: AuthContext, id: string) {
    await this.lock(tx, id);
    const { r, staff } = await this.load(tx, tenant, auth, id);
    const me = r.signers.find((s) => s.membershipId === tenant.membershipId);
    if (!me) throw new ForbiddenError();
    if (r.status !== 'PENDING') {
      throw new AppError('SIGNATURE_CLOSED', `This request is ${r.status.toLowerCase()}`, 409);
    }
    if (r.expiresAt && r.expiresAt <= new Date()) {
      throw new AppError(
        'SIGNATURE_EXPIRED',
        'This request has passed its deadline. Ask the sender to send it again.',
        409,
      );
    }
    if (me.status === 'WAITING') {
      throw new AppError(
        'SIGNATURE_NOT_YOUR_TURN',
        'Someone before you still has to sign. You’ll be told when it’s your turn.',
        409,
      );
    }
    if (me.status !== 'PENDING') {
      throw new AppError(
        'SIGNATURE_ALREADY_ANSWERED',
        `You have already ${me.status === 'SIGNED' ? 'signed' : 'declined'}`,
        409,
      );
    }
    return { r, me, staff };
  }

  async sign(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof signSchema>,
    meta: RequestMeta,
  ) {
    return this.documents.run(tenant, auth, async (tx) => {
      const { r, me, staff } = await this.mySigner(tx, tenant, auth, id);
      const original = await tx.storedFile.findUniqueOrThrow({ where: { id: r.document.fileId } });
      const data = await this.files.read(original);
      if (sha256(data) !== r.documentSha256) {
        throw new AppError(
          'DOCUMENT_CHANGED',
          'The document no longer matches what was sent, so it can’t be signed.',
          409,
        );
      }
      const now = new Date();
      await tx.signatureSigner.update({
        where: { id: me.id },
        data: {
          status: 'SIGNED',
          signedName: input.signedName,
          signedAt: now,
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
        },
      });
      await this.record(tx, tenant, auth, 'signature.sign', r.id, meta, {
        signerId: me.id,
        sha256: r.documentSha256,
      });

      const signers = await tx.signatureSigner.findMany({
        where: { requestId: r.id },
        orderBy: { position: 'asc' },
      });
      if (signers.every((s) => s.status === 'SIGNED')) {
        await this.complete(tx, tenant, r, signers, data, now);
      } else if (r.sequential) {
        const next = signers.find((s) => s.status === 'WAITING');
        if (next && !signers.some((s) => s.status === 'PENDING')) {
          await tx.signatureSigner.update({ where: { id: next.id }, data: { status: 'PENDING' } });
          await this.notify(
            tx,
            tenant.id,
            [next.userId],
            r.id,
            `Please sign: ${r.title}`,
            `It’s your turn to sign “${r.title}”.`,
          );
        }
      }
      const fresh = await tx.signatureRequest.findUniqueOrThrow({ where: { id }, include: REQUEST_INCLUDE });
      return this.present(fresh, tenant, auth, staff);
    });
  }

  private async complete(
    tx: TenantTransaction,
    tenant: TenantContext,
    r: RequestRow,
    signers: {
      name: string;
      email: string;
      signedName: string | null;
      signedAt: Date | null;
      ipAddress: string | null;
      userId: string;
    }[],
    original: Buffer,
    now: Date,
  ) {
    const org = await tx.tenant.findUniqueOrThrow({
      where: { id: tenant.id },
      select: { name: true, brandName: true },
    });
    const requester = await tx.user.findUnique({
      where: { id: r.requestedByUserId },
      select: { displayName: true },
    });
    const signed = await appendCertificate(original, {
      requestId: r.id,
      title: r.title,
      organisation: org.brandName ?? org.name,
      documentSha256: r.documentSha256,
      requestedBy: requester?.displayName ?? 'Unknown',
      sentAt: r.createdAt,
      completedAt: now,
      signers: signers.map((s) => ({
        name: s.name,
        email: s.email,
        signedName: s.signedName!,
        signedAt: s.signedAt!,
        ipAddress: s.ipAddress,
      })),
    });
    const file = await this.files.store(tx, tenant.id, {
      data: signed,
      fileName: cleanFileName(`${r.document.title} (signed).pdf`),
      mimeType: 'application/pdf',
      uploadedByUserId: null,
    });
    await tx.employeeDocument.create({
      data: {
        tenantId: tenant.id,
        employeeId: r.document.employeeId,
        fileId: file.id,
        title: `${r.document.title} (signed)`,
        category: r.document.category,
        visibleToEmployee: r.document.visibleToEmployee,
        uploadedByUserId: r.requestedByUserId,
      },
    });
    await tx.signatureRequest.update({
      where: { id: r.id },
      data: { status: 'COMPLETED', signedFileId: file.id, completedAt: now, closedAt: now },
    });
    await this.notify(
      tx,
      tenant.id,
      [r.requestedByUserId, ...signers.map((s) => s.userId)],
      r.id,
      `Signed by everyone: ${r.title}`,
      `Everyone has signed “${r.title}”. The signed copy, with its signature certificate, is ready.`,
    );
  }

  async decline(
    tenant: TenantContext,
    auth: AuthContext,
    id: string,
    input: z.output<typeof declineSchema>,
    meta: RequestMeta,
  ) {
    return this.documents.run(tenant, auth, async (tx) => {
      const { r, me, staff } = await this.mySigner(tx, tenant, auth, id);
      const now = new Date();
      await tx.signatureSigner.update({
        where: { id: me.id },
        data: {
          status: 'DECLINED',
          declinedAt: now,
          declineReason: input.reason,
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
        },
      });
      await tx.signatureRequest.update({ where: { id }, data: { status: 'DECLINED', closedAt: now } });
      await this.record(tx, tenant, auth, 'signature.decline', r.id, meta, { signerId: me.id });
      await this.notify(
        tx,
        tenant.id,
        [r.requestedByUserId, ...r.signers.filter((s) => s.status === 'SIGNED').map((s) => s.userId)],
        r.id,
        `Declined: ${r.title}`,
        `${me.name} declined to sign “${r.title}”: ${input.reason}`,
      );
      const fresh = await tx.signatureRequest.findUniqueOrThrow({ where: { id }, include: REQUEST_INCLUDE });
      return this.present(fresh, tenant, auth, staff);
    });
  }

  async cancel(tenant: TenantContext, auth: AuthContext, id: string, meta: RequestMeta) {
    return this.documents.run(tenant, auth, async (tx) => {
      await this.lock(tx, id);
      const { r, staff } = await this.load(tx, tenant, auth, id);
      if (r.requestedByUserId !== auth.user.id && !staff) throw new ForbiddenError();
      if (r.status !== 'PENDING')
        throw new AppError('SIGNATURE_CLOSED', `This request is ${r.status.toLowerCase()}`, 409);
      await tx.signatureRequest.update({
        where: { id },
        data: { status: 'CANCELLED', closedAt: new Date() },
      });
      await this.record(tx, tenant, auth, 'signature.cancel', id, meta);
      await this.notify(
        tx,
        tenant.id,
        r.signers.filter((s) => s.status === 'PENDING').map((s) => s.userId),
        id,
        `No longer needed: ${r.title}`,
        `${auth.user.displayName} cancelled the request to sign “${r.title}”. You don’t need to do anything.`,
      );
      const fresh = await tx.signatureRequest.findUniqueOrThrow({ where: { id }, include: REQUEST_INCLUDE });
      return this.present(fresh, tenant, auth, staff);
    });
  }
}
