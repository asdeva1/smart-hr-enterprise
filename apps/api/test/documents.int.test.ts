/**
 * Documents and e-signatures through the real API, database and file storage: who sees which documents,
 * what may be uploaded, files encrypted at rest and checked on the way out, letters from templates, and
 * signing in order with the evidence kept and the database refusing rewrites.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabaseClient, withTenant } from '@smart-hr/database';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderLetterPdf } from '../src/documents/pdf.js';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import {
  Browser,
  DEFAULT_PASSWORD,
  Fixtures,
  ownerClient,
  requireEnv,
  startApp,
  testEnv,
} from './helpers.js';

const db = ownerClient();
const runtime = createDatabaseClient({ connectionString: requireEnv('DATABASE_URL'), maxConnections: 2 });
const fx = new Fixtures(db);
const storageDir = mkdtempSync(join(tmpdir(), 'shr-docs-'));
let app: NestExpressApplication;
let tenantId: string;
let ownerId: string;
let owner: Browser;
let acme: string;

interface Person {
  employeeId: string;
  browser: Browser;
  membershipId: string;
  userId: string;
}

async function person(label: string, permissions?: string[]): Promise<Person> {
  const user = await fx.user(label);
  const m = await fx.member(tenantId, user.id);
  if (permissions) {
    await fx.assign(tenantId, m.id, await fx.customRole(tenantId, label, permissions), {
      type: 'TENANT',
      id: tenantId,
    });
  }
  const res = await owner.send('post', '/v1/employees', {
    firstName: label,
    lastName: 'Test',
    companyId: acme,
    dateOfJoining: '2025-01-01',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await db.employee.update({ where: { id: res.body.id }, data: { membershipId: m.id } });
  const browser = new Browser(app);
  expect((await browser.login(user.email)).status).toBe(200);
  return { employeeId: res.body.id as string, browser, membershipId: m.id, userId: user.id };
}

/** Multipart upload through the same agent (cookies, CSRF, origin). */
async function upload(
  who: Browser,
  employeeId: string,
  file: { data: Buffer | Uint8Array; name: string },
  fields: Record<string, string> = {},
) {
  let req = who.agent.post(`/v1/documents/employee/${employeeId}`).set('Origin', 'http://localhost:3000');
  if (who.csrf) req = req.set('x-csrf-token', who.csrf);
  req = req.attach('file', Buffer.from(file.data), file.name);
  for (const [k, v] of Object.entries({ title: 'A document', category: 'OTHER', ...fields }))
    req = req.field(k, v);
  return await req;
}

async function binary(who: Browser, path: string) {
  return who.agent
    .get(path)
    .set('Origin', 'http://localhost:3000')
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
}

const statuses = (body: unknown) => (body as { signers: { status: string }[] }).signers.map((s) => s.status);
const pdf = (body: string) => renderLetterPdf({ organisation: 'Acme', title: 'Contract', body, footer: '' });

let hr: Person;
let nurse: Person;
let colleague: Person;

beforeAll(async () => {
  await syncPlanCatalogue(db);
  app = await startApp(testEnv({ STORAGE_LOCAL_DIR: storageDir, DOCUMENT_MAX_UPLOAD_MB: '1' }));
  const tenant = await fx.tenant('Documents');
  tenantId = tenant.id;
  const ownerUser = await fx.user('doc-owner');
  ownerId = ownerUser.id;
  await fx.member(tenantId, ownerUser.id, true);
  owner = new Browser(app);
  expect((await owner.login(ownerUser.email)).status).toBe(200);
  acme = (await fx.company(tenantId, 'ACME')).id;
  hr = await person('doc-hr', [
    'employees.view',
    'documents.view',
    'documents.manage',
    'documents.configure',
  ]);
  nurse = await person('doc-nurse');
  colleague = await person('doc-colleague');
});

afterAll(async () => {
  await app?.close();
  await fx.cleanup();
  await runtime.$disconnect();
  await db.$disconnect();
  rmSync(storageDir, { recursive: true, force: true });
});

describe('employee documents', () => {
  let shared: string;
  let hidden: string;

  it('lets HR upload; the employee sees only what is shared with them', async () => {
    const bytes = await pdf('The contract text.');
    const a = await upload(
      hr.browser,
      nurse.employeeId,
      { data: bytes, name: 'contract.pdf' },
      {
        title: 'Employment contract',
        category: 'CONTRACT',
        expiresOn: '2030-01-31',
        notes: 'Signed copy to follow',
      },
    );
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body).toMatchObject({
      title: 'Employment contract',
      category: 'CONTRACT',
      expiresOn: '2030-01-31',
      visibleToEmployee: true,
      file: { name: 'contract.pdf', mimeType: 'application/pdf', size: bytes.length },
      can: { manage: true, sendForSignature: true },
    });
    shared = a.body.id as string;
    const b = await upload(
      hr.browser,
      nurse.employeeId,
      { data: Buffer.from('Medical notes'), name: 'notes.txt' },
      {
        title: 'Fitness report',
        category: 'MEDICAL',
        visibleToEmployee: 'false',
      },
    );
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    hidden = b.body.id as string;

    const mine = (await nurse.browser.get('/v1/documents/me')).body as {
      items: { id: string; notes: string | null }[];
    };
    expect(mine.items.map((d) => d.id)).toEqual([shared]);
    expect(mine.items[0]?.notes).toBeNull(); // HR notes stay with HR
    expect((await nurse.browser.get(`/v1/documents/${hidden}`)).status).toBe(404);
    expect((await nurse.browser.get(`/v1/documents/${hidden}/file`)).status).toBe(404);
    const staff = (await hr.browser.get(`/v1/documents/employee/${nurse.employeeId}`)).body;
    expect(staff.items).toHaveLength(2);

    // A colleague (or a manager without documents.view) sees nothing, and can't tell the employee exists.
    expect((await colleague.browser.get(`/v1/documents/employee/${nurse.employeeId}`)).status).toBe(404);
    expect((await colleague.browser.get(`/v1/documents/${shared}`)).status).toBe(404);
  });

  it('stores files encrypted and returns exactly what was uploaded, auditing the download', async () => {
    const res = await binary(nurse.browser, `/v1/documents/${shared}/file`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment; filename="contract.pdf"');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');

    const file = await db.storedFile.findFirstOrThrow({ where: { documents: { some: { id: shared } } } });
    const onDisk = readFileSync(join(storageDir, file.storageKey));
    expect(onDisk.subarray(0, 4).toString()).toBe('SHB1');
    expect(onDisk.includes(body.subarray(0, 64))).toBe(false);

    const audit = await db.auditEvent.findFirst({
      where: { tenantId, action: 'document.download', targetId: file.id, actorUserId: nurse.userId },
    });
    expect(audit).not.toBeNull();
  });

  it('refuses a file whose content is damaged on disk', async () => {
    const res = await upload(hr.browser, nurse.employeeId, {
      data: Buffer.from('Some text'),
      name: 'damaged.txt',
    });
    expect(res.status).toBe(201);
    const file = await db.storedFile.findFirstOrThrow({
      where: { documents: { some: { id: res.body.id } } },
    });
    const path = join(storageDir, file.storageKey);
    const sealed = readFileSync(path);
    sealed[sealed.length - 1] = sealed[sealed.length - 1]! ^ 1;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, sealed);
    const download = await hr.browser.get(`/v1/documents/${res.body.id}/file`);
    expect(download.status).toBe(500);
    expect(download.body.code).toBe('FILE_UNAVAILABLE');
  });

  it('accepts only known file types whose name matches their content, within the size limit', async () => {
    const html = await upload(hr.browser, nurse.employeeId, {
      data: Buffer.from('<html><script>alert(1)</script></html>'),
      name: 'invoice.pdf',
    });
    expect(html.status).toBe(400);
    expect(html.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
    const exe = await upload(hr.browser, nurse.employeeId, {
      data: Buffer.from([0x4d, 0x5a, 0x90, 0]),
      name: 'a.exe',
    });
    expect(exe.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
    const renamed = await upload(hr.browser, nurse.employeeId, { data: await pdf('x'), name: 'photo.png' });
    expect(renamed.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
    const big = await upload(hr.browser, nurse.employeeId, {
      data: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(1024 * 1024 + 10, 32)]),
      name: 'big.pdf',
    });
    expect(big.status).toBe(413);
    const none = await hr.browser.send('post', `/v1/documents/employee/${nurse.employeeId}`, {
      title: 'Nothing attached',
      category: 'OTHER',
    });
    expect(none.status).toBe(400);
    expect(none.body.code).toBe('FILE_REQUIRED');
    const badFields = await upload(
      hr.browser,
      nurse.employeeId,
      { data: Buffer.from('ok'), name: 'a.txt' },
      {
        category: 'SECRET',
      },
    );
    expect(badFields.status).toBe(400);
  });

  it('lets employees add to their own record (always shared with them) but not change it', async () => {
    const own = await upload(
      nurse.browser,
      nurse.employeeId,
      { data: Buffer.from('BSc Nursing'), name: 'degree.txt' },
      {
        title: 'Degree certificate',
        category: 'EDUCATION',
        visibleToEmployee: 'false',
        notes: 'ignored',
      },
    );
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    expect(own.body).toMatchObject({ visibleToEmployee: true, notes: null, can: { manage: false } });
    expect(
      (await upload(nurse.browser, colleague.employeeId, { data: Buffer.from('x'), name: 'x.txt' })).status,
    ).toBe(404);
    expect((await nurse.browser.send('post', `/v1/documents/${own.body.id}/archive`)).status).toBe(403);
    expect(
      (await nurse.browser.send('patch', `/v1/documents/${own.body.id}`, { title: 'Changed' })).status,
    ).toBe(403);
  });

  it('lets HR change details and archive; archived documents leave the employee’s view', async () => {
    const changed = await hr.browser.send('patch', `/v1/documents/${shared}`, { expiresOn: '2026-11-01' });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    const expiring = (await hr.browser.get('/v1/documents/expiring?days=60')).body as { id: string }[];
    expect(expiring.map((d) => d.id)).toContain(shared);
    expect((await nurse.browser.get('/v1/documents/expiring')).status).toBe(403);

    const archived = await hr.browser.send('post', `/v1/documents/${hidden}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body.status).toBe('ARCHIVED');
    expect((await hr.browser.send('patch', `/v1/documents/${hidden}`, { title: 'Again' })).body.code).toBe(
      'DOCUMENT_ARCHIVED',
    );
    const active = (await hr.browser.get(`/v1/documents/employee/${nurse.employeeId}`)).body.items as {
      id: string;
    }[];
    expect(active.map((d) => d.id)).not.toContain(hidden);
    const all = (await hr.browser.get(`/v1/documents/employee/${nurse.employeeId}?status=ALL`)).body
      .items as {
      id: string;
    }[];
    expect(all.map((d) => d.id)).toContain(hidden);
  });

  it('keeps files and their links unchangeable in the database', async () => {
    const doc = await db.employeeDocument.findUniqueOrThrow({ where: { id: shared } });
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.employeeDocument.update({ where: { id: shared }, data: { fileId: doc.id } }),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.storedFile.update({ where: { id: doc.fileId }, data: { sha256: 'x' } }),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(runtime, tenantId, (tx) => tx.storedFile.delete({ where: { id: doc.fileId } })),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.employeeDocument.update({ where: { id: hidden }, data: { status: 'ACTIVE', archivedAt: null } }),
      ),
    ).rejects.toThrow(/archived/);
    // Another organisation sees none of it.
    const other = await fx.tenant('Documents other');
    expect(await withTenant(runtime, other.id, (tx) => tx.employeeDocument.count())).toBe(0);
    expect(await withTenant(runtime, other.id, (tx) => tx.storedFile.count())).toBe(0);
  });

  it('stops uploads at the plan’s storage limit', async () => {
    await db.entitlementOverride.create({
      data: {
        tenantId,
        kind: 'LIMIT',
        key: 'storage.gb',
        value: 0,
        reason: 'test',
        createdByUserId: ownerId,
      },
    });
    try {
      const res = await upload(hr.browser, nurse.employeeId, { data: Buffer.from('more'), name: 'more.txt' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('LIMIT_REACHED');
    } finally {
      await db.entitlementOverride.deleteMany({ where: { tenantId, key: 'storage.gb' } });
    }
    expect(readdirSync(join(storageDir, tenantId)).length).toBeGreaterThan(0);
  });
});

describe('letters', () => {
  let templateId: string;

  it('refuses templates with unknown placeholders and fills known ones', async () => {
    const bad = await hr.browser.send('post', '/v1/documents/templates', {
      name: 'Bad template',
      body: 'Dear {{employee.name}}, your salary is {{employee.salary}}.',
    });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('{{employee.salary}}');

    const created = await hr.browser.send('post', '/v1/documents/templates', {
      name: 'Appointment letter',
      category: 'LETTER',
      body: 'Dear {{employee.firstName}},\n\nWelcome to {{organisation.name}} as employee {{employee.code}}, from {{employee.joinDate}}.',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    templateId = created.body.id as string;
    expect(
      (
        await hr.browser.send('post', '/v1/documents/templates', {
          name: 'appointment LETTER',
          body: 'Hello there {{today}}',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await nurse.browser.send('post', '/v1/documents/templates', {
          name: 'Mine',
          body: 'Hello there {{today}}',
        })
      ).status,
    ).toBe(403);

    const preview = await hr.browser.get(
      `/v1/documents/employee/${nurse.employeeId}/letters/preview?templateId=${templateId}`,
    );
    expect(preview.status).toBe(200);
    expect(preview.body.body).toContain('Dear doc-nurse,');
    expect(preview.body.body).toContain('1 January 2025');
    expect(preview.body.body).not.toContain('{{');
  });

  it('makes a PDF letter on the employee’s record', async () => {
    const res = await hr.browser.send('post', `/v1/documents/employee/${nurse.employeeId}/letters`, {
      templateId,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ category: 'LETTER', file: { mimeType: 'application/pdf' } });
    expect(res.body.title).toContain('Appointment letter');
    const file = await binary(nurse.browser, `/v1/documents/${res.body.id}/file`);
    expect(file.status).toBe(200);
    expect((await PDFDocument.load(file.body as Buffer)).getPageCount()).toBe(1);
  });
});

describe('signatures', () => {
  let documentId: string;
  let requestId: string;

  it('sends a PDF to sign in order', async () => {
    const doc = await upload(
      hr.browser,
      nurse.employeeId,
      { data: await pdf('Offer terms.'), name: 'offer.pdf' },
      {
        title: 'Offer letter',
        category: 'LETTER',
      },
    );
    documentId = doc.body.id as string;
    const text = await upload(hr.browser, nurse.employeeId, {
      data: Buffer.from('not a pdf'),
      name: 'a.txt',
    });
    const notPdf = await hr.browser.send('post', `/v1/documents/${text.body.id}/signatures`, {
      signerMembershipIds: [nurse.membershipId],
    });
    expect(notPdf.body.code).toBe('SIGNATURE_NEEDS_PDF');
    expect(
      (
        await nurse.browser.send('post', `/v1/documents/${documentId}/signatures`, {
          signerMembershipIds: [nurse.membershipId],
        })
      ).status,
    ).toBe(403);

    const people = (await hr.browser.get('/v1/signatures/people?search=doc-nurse')).body as {
      membershipId: string;
    }[];
    expect(people.map((p) => p.membershipId)).toEqual([nurse.membershipId]);
    expect((await nurse.browser.get('/v1/signatures/people')).status).toBe(403);

    const res = await hr.browser.send('post', `/v1/documents/${documentId}/signatures`, {
      message: 'Please sign by Friday',
      signerMembershipIds: [nurse.membershipId, hr.membershipId],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    requestId = res.body.id as string;
    expect(statuses(res.body)).toEqual(['PENDING', 'WAITING']);
    expect(
      (
        await hr.browser.send('post', `/v1/documents/${documentId}/signatures`, {
          signerMembershipIds: [hr.membershipId],
        })
      ).body.code,
    ).toBe('SIGNATURE_PENDING');
    expect((await hr.browser.send('post', `/v1/documents/${documentId}/archive`)).body.code).toBe(
      'SIGNATURE_PENDING',
    );

    const notice = await db.notification.findFirst({
      where: { tenantId, recipientUserId: nurse.userId, category: 'document.signature' },
    });
    expect(notice).toMatchObject({
      title: 'Please sign: Offer letter',
      link: `/documents/signatures/${requestId}`,
    });
    const waiting = (await nurse.browser.get('/v1/signatures?scope=mine&status=PENDING')).body as {
      id: string;
    }[];
    expect(waiting.map((r) => r.id)).toContain(requestId);
    expect((await colleague.browser.get(`/v1/signatures/${requestId}`)).status).toBe(404);
  });

  it('lets each signer sign only on their turn, then makes the signed copy with its certificate', async () => {
    const early = await hr.browser.send('post', `/v1/signatures/${requestId}/sign`, {
      signedName: 'HR Person',
      consent: true,
    });
    expect(early.body.code).toBe('SIGNATURE_NOT_YOUR_TURN');
    const noConsent = await nurse.browser.send('post', `/v1/signatures/${requestId}/sign`, {
      signedName: 'Nurse',
    });
    expect(noConsent.status).toBe(400);

    // Signers can read the document even though they couldn't otherwise see it.
    expect((await binary(nurse.browser, `/v1/signatures/${requestId}/document`)).status).toBe(200);

    await nurse.browser.send('post', '/v1/auth/reauthenticate', { password: DEFAULT_PASSWORD });
    const first = await nurse.browser.send('post', `/v1/signatures/${requestId}/sign`, {
      signedName: 'Doc Nurse',
      consent: true,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(statuses(first.body)).toEqual(['SIGNED', 'PENDING']);
    expect(
      (
        await nurse.browser.send('post', `/v1/signatures/${requestId}/sign`, {
          signedName: 'Again',
          consent: true,
        })
      ).body.code,
    ).toBe('SIGNATURE_ALREADY_ANSWERED');
    expect(
      await db.notification.count({
        where: { tenantId, recipientUserId: hr.userId, title: 'Please sign: Offer letter' },
      }),
    ).toBe(1);

    await hr.browser.send('post', '/v1/auth/reauthenticate', { password: DEFAULT_PASSWORD });
    const done = await hr.browser.send('post', `/v1/signatures/${requestId}/sign`, {
      signedName: 'Doc HR',
      consent: true,
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ status: 'COMPLETED', hasSignedCopy: true });

    const signed = await binary(nurse.browser, `/v1/signatures/${requestId}/signed`);
    expect(signed.status).toBe(200);
    expect((await PDFDocument.load(signed.body as Buffer)).getPageCount()).toBe(2);
    const docs = (await nurse.browser.get('/v1/documents/me')).body.items as { title: string }[];
    expect(docs.map((d) => d.title)).toContain('Offer letter (signed)');

    const signer = await db.signatureSigner.findFirstOrThrow({
      where: { requestId, membershipId: nurse.membershipId },
    });
    expect(signer).toMatchObject({ signedName: 'Doc Nurse', status: 'SIGNED' });
    expect(signer.signedAt).not.toBeNull();
    expect(
      await db.notification.count({ where: { tenantId, title: 'Signed by everyone: Offer letter' } }),
    ).toBe(2);
  });

  it('keeps what was signed, and by whom, final', async () => {
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.signatureRequest.update({ where: { id: requestId }, data: { documentSha256: 'x' } }),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.signatureSigner.updateMany({ where: { requestId }, data: { signedName: 'Someone else' } }),
      ),
    ).rejects.toThrow(/already signed/);
    await expect(
      withTenant(runtime, tenantId, (tx) =>
        tx.signatureRequest.update({ where: { id: requestId }, data: { status: 'CANCELLED' } }),
      ),
    ).rejects.toThrow(/already completed/);
    expect((await hr.browser.send('post', `/v1/signatures/${requestId}/cancel`)).body.code).toBe(
      'SIGNATURE_CLOSED',
    );
  });

  it('records a refusal and closes the request; the sender can cancel an open one', async () => {
    const declineMe = await hr.browser.send('post', `/v1/documents/${documentId}/signatures`, {
      title: 'Policy acknowledgement',
      signerMembershipIds: [nurse.membershipId, colleague.membershipId],
      sequential: false,
    });
    expect(declineMe.status).toBe(201);
    expect(statuses(declineMe.body)).toEqual(['PENDING', 'PENDING']);
    const declined = await colleague.browser.send('post', `/v1/signatures/${declineMe.body.id}/decline`, {
      reason: 'Not my department',
    });
    expect(declined.status, JSON.stringify(declined.body)).toBe(200);
    expect(declined.body.status).toBe('DECLINED');
    expect(
      (
        await nurse.browser.send('post', `/v1/signatures/${declineMe.body.id}/sign`, {
          signedName: 'Doc Nurse',
          consent: true,
        })
      ).body.code,
    ).toBe('SIGNATURE_CLOSED');
    expect(
      await db.notification.count({
        where: { tenantId, recipientUserId: hr.userId, title: 'Declined: Policy acknowledgement' },
      }),
    ).toBe(1);

    const again = await hr.browser.send('post', `/v1/documents/${documentId}/signatures`, {
      signerMembershipIds: [colleague.membershipId],
    });
    expect((await colleague.browser.send('post', `/v1/signatures/${again.body.id}/cancel`)).status).toBe(403);
    const cancelled = await hr.browser.send('post', `/v1/signatures/${again.body.id}/cancel`);
    expect(cancelled.body.status).toBe('CANCELLED');
  });

  it('needs the e-signature feature in the plan', async () => {
    await db.entitlementOverride.create({
      data: {
        tenantId,
        kind: 'FEATURE',
        key: 'esignature',
        enabled: false,
        reason: 'test',
        createdByUserId: ownerId,
      },
    });
    try {
      const res = await nurse.browser.get('/v1/signatures');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ENTITLEMENT_REQUIRED');
      expect((await nurse.browser.get('/v1/documents/me')).status).toBe(200);
    } finally {
      await db.entitlementOverride.deleteMany({ where: { tenantId, key: 'esignature' } });
    }
  });
});
