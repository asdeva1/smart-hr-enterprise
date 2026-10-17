/**
 * The document sweep against the real database, running as app_rw like the deployed worker: expiry
 * reminders go out once, to the right people, and overdue signature requests are closed.
 * Fixtures are written with the owner connection.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDatabaseClient } from '@smart-hr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadWorkerEnv } from '../src/config/env.js';
import { DocumentSweepService } from '../src/notifications/document-sweep.service.js';
import { WorkerModule } from '../src/worker.module.js';

const run = randomUUID().slice(0, 8);
const owner = createDatabaseClient({
  connectionString: process.env.DATABASE_MIGRATOR_URL!,
  maxConnections: 2,
});
const DAY = 86_400_000;
const date = (n: number) =>
  new Date(`${new Date(Date.now() + n * DAY).toISOString().slice(0, 10)}T00:00:00Z`);
let app: INestApplicationContext;
let sweeper: DocumentSweepService;
let tenantId: string;
const users: string[] = [];

async function user(label: string) {
  const u = await owner.user.create({
    data: { email: `${label}-${run}@test.local`.toLowerCase(), displayName: label },
  });
  users.push(u.id);
  return u;
}

beforeAll(async () => {
  const env = loadWorkerEnv({
    ...process.env,
    NODE_ENV: 'test',
    QUEUE_PREFIX: `test-docs-${run}`,
    EMAIL_SWEEP_INTERVAL_MS: '0',
    APPROVAL_ESCALATION_INTERVAL_MS: '0',
    SUBSCRIPTION_SWEEP_INTERVAL_MS: '0',
    DOCUMENT_SWEEP_INTERVAL_MS: '0',
    DOCUMENT_REMINDER_DAYS: '30',
  });
  app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env, { mailTransport: null }), {
    logger: false,
  });
  sweeper = app.get(DocumentSweepService);
  const tenant = await owner.tenant.create({ data: { slug: `docsweep-${run}`, name: 'Doc sweep' } });
  tenantId = tenant.id;
});

afterAll(async () => {
  await app?.close();
  const inTenant = { tenantId };
  await owner.notification.deleteMany({ where: inTenant });
  await owner.signatureSigner.deleteMany({ where: inTenant });
  await owner.signatureRequest.deleteMany({ where: inTenant });
  await owner.employeeDocument.deleteMany({ where: inTenant });
  await owner.storedFile.deleteMany({ where: inTenant });
  await owner.employee.deleteMany({ where: inTenant });
  await owner.company.deleteMany({ where: inTenant });
  await owner.tenantMembership.deleteMany({ where: inTenant });
  await owner.user.deleteMany({ where: { id: { in: users } } });
  await owner.tenant.deleteMany({ where: { id: tenantId } });
  await owner.$disconnect();
});

/** Sweeps until a sweep that held the lock had nothing left to do. */
async function sweepAll() {
  const totals = { reminded: 0, expired: 0 };
  for (let i = 0; i < 200; i++) {
    const r = await sweeper.sweep();
    totals.reminded += r.reminded;
    totals.expired += r.expired;
    if (!r.skipped && r.reminded === 0 && r.expired === 0) return totals;
    if (r.skipped) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The sweep never finished');
}

describe('document sweep', () => {
  it('reminds once about expiring documents and closes overdue signature requests', async () => {
    const hr = await user('docsweep-hr');
    const staff = await user('docsweep-nurse');
    const membership = await owner.tenantMembership.create({ data: { tenantId, userId: staff.id } });
    await owner.tenantMembership.create({ data: { tenantId, userId: hr.id } });
    const company = await owner.company.create({
      data: {
        tenantId,
        code: `C${run}`.toUpperCase(),
        name: 'Co',
        country: 'IN',
        baseCurrency: 'INR',
        timezone: 'Asia/Kolkata',
      },
    });
    const employee = await owner.employee.create({
      data: {
        tenantId,
        employeeCode: `E${run}`,
        firstName: 'Asha',
        lastName: 'Rao',
        companyId: company.id,
        dateOfJoining: date(-400),
        membershipId: membership.id,
      },
    });
    let n = 0;
    const doc = async (title: string, expiresOn: Date | null, visibleToEmployee = true) => {
      const fileId = randomUUID();
      await owner.storedFile.create({
        data: {
          id: fileId,
          tenantId,
          storageKey: `${tenantId}/${fileId}`,
          fileName: `f${n++}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 10,
          sha256: 'a'.repeat(64),
          encryptionKeyId: 'd1',
        },
      });
      return owner.employeeDocument.create({
        data: {
          tenantId,
          employeeId: employee.id,
          fileId,
          title,
          category: 'IDENTITY',
          expiresOn,
          visibleToEmployee,
          uploadedByUserId: hr.id,
        },
      });
    };
    const passport = await doc('Passport', date(10));
    const visa = await doc('Work visa', date(-2), false);
    const later = await doc('Licence', date(120));
    const never = await doc('Degree', null);
    const contract = await doc('Contract', null);
    const overdue = await owner.signatureRequest.create({
      data: {
        tenantId,
        documentId: contract.id,
        title: 'Contract',
        documentSha256: 'a'.repeat(64),
        requestedByUserId: hr.id,
        expiresAt: new Date(Date.now() - 60_000),
        signers: {
          create: [
            {
              position: 1,
              membershipId: membership.id,
              userId: staff.id,
              name: 'Asha',
              email: staff.email,
              status: 'PENDING',
            },
          ],
        },
      },
    });
    const open = await owner.signatureRequest.create({
      data: {
        tenantId,
        documentId: passport.id,
        title: 'Passport copy',
        documentSha256: 'a'.repeat(64),
        requestedByUserId: hr.id,
        expiresAt: new Date(Date.now() + DAY),
      },
    });

    await Promise.all([sweeper.sweep(), sweeper.sweep()]);
    await sweepAll();

    const notices = await owner.notification.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
    const titles = (userId: string) =>
      notices
        .filter((x) => x.recipientUserId === userId)
        .map((x) => x.title)
        .sort();
    expect(titles(hr.id)).toEqual(
      [
        'Not signed in time: Contract',
        'Passport expires on ' + day(date(10)),
        'Work visa expired on ' + day(date(-2)),
      ].sort(),
    );
    // The visa isn't shared with the employee, so only HR hears about it.
    expect(titles(staff.id)).toEqual(
      ['Not signed in time: Contract', 'Passport expires on ' + day(date(10))].sort(),
    );

    const after = await owner.employeeDocument.findMany({
      where: { id: { in: [passport.id, visa.id, later.id, never.id] } },
    });
    const notified = new Map(after.map((d) => [d.id, d.expiryNotifiedAt]));
    expect(notified.get(passport.id)).not.toBeNull();
    expect(notified.get(visa.id)).not.toBeNull();
    expect(notified.get(later.id)).toBeNull();
    expect(notified.get(never.id)).toBeNull();

    expect((await owner.signatureRequest.findUniqueOrThrow({ where: { id: overdue.id } })).status).toBe(
      'EXPIRED',
    );
    expect((await owner.signatureRequest.findUniqueOrThrow({ where: { id: open.id } })).status).toBe(
      'PENDING',
    );

    // Nothing is sent twice.
    await sweepAll();
    expect(await owner.notification.count({ where: { tenantId } })).toBe(notices.length);
  });
});

function day(d: Date) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
