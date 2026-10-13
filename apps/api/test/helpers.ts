/**
 * Shared setup for API integration tests: configuration, database fixtures and a cookie-aware client.
 * Requires DATABASE_URL (app_rw), DATABASE_MIGRATOR_URL (owner, fixtures only) and REDIS_URL.
 */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { hashPassword, SecretBox } from '@smart-hr/auth';
import { createDatabaseClient, type DatabaseClient } from '@smart-hr/database';
import { NotificationJob, QUEUES, type EmailJobData } from '@smart-hr/shared';
import { Queue } from 'bullmq';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { loadApiEnv, type ApiEnv } from '../src/config/env.js';
import { RbacService } from '../src/rbac/rbac.service.js';

export const WEB_ORIGIN = 'http://localhost:3000';
export const MFA_KEY = randomBytes(32).toString('base64');

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set for integration tests`);
  return value;
}

export function testEnv(overrides: Record<string, string> = {}): ApiEnv {
  return loadApiEnv({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    CORS_ORIGINS: WEB_ORIGIN,
    QUEUE_PREFIX: `test-${randomUUID().slice(0, 8)}`,
    MFA_ENCRYPTION_KEYS: `t1:${MFA_KEY}`,
    MFA_ENCRYPTION_KEY_ID: 't1',
    // Generous defaults so unrelated tests don't trip limits; limit tests lower them explicitly.
    AUTH_RATE_LIMIT_LOGIN_PER_IP: '10000',
    AUTH_RATE_LIMIT_LOGIN_PER_EMAIL: '1000',
    AUTH_RATE_LIMIT_RESET_PER_EMAIL: '100',
    AUTH_RATE_LIMIT_RESET_PER_IP: '10000',
    ...overrides,
  });
}

export async function startApp(env: ApiEnv): Promise<NestExpressApplication> {
  const app = await createApp(env);
  await app.init();
  return app;
}

export function ownerClient(): DatabaseClient {
  return createDatabaseClient({ connectionString: requireEnv('DATABASE_MIGRATOR_URL'), maxConnections: 3 });
}

export const DEFAULT_PASSWORD = 'violet harbour sunrise 42';

/** Creates and tracks fixtures so each test file cleans up exactly what it made. */
export class Fixtures {
  readonly run = randomUUID().slice(0, 8);
  private readonly tenants: string[] = [];
  private readonly users: string[] = [];

  constructor(readonly db: DatabaseClient) {}

  async tenant(name: string, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') {
    const tenant = await this.db.tenant.create({
      data: { slug: `${name.toLowerCase()}-${this.run}-${this.tenants.length}`, name, status },
    });
    this.tenants.push(tenant.id);
    return tenant;
  }

  async user(
    label: string,
    options: { password?: string; status?: 'ACTIVE' | 'DISABLED'; platformAdmin?: boolean } = {},
  ) {
    const user = await this.db.user.create({
      data: {
        email: `${label}-${this.run}-${this.users.length}@test.local`.toLowerCase(),
        displayName: label,
        passwordHash: await hashPassword(options.password ?? DEFAULT_PASSWORD),
        status: options.status ?? 'ACTIVE',
        isPlatformAdmin: options.platformAdmin ?? false,
      },
    });
    this.users.push(user.id);
    return user;
  }

  /** Cleans up a user created by the API (e.g. through an invitation). */
  trackUser(userId: string): void {
    this.users.push(userId);
  }

  async member(tenantId: string, userId: string, isTenantAdmin = false) {
    return this.db.tenantMembership.create({ data: { tenantId, userId, isTenantAdmin } });
  }

  /** A built-in role of the tenant (created on first use, as the bootstrap command does). */
  async systemRole(tenantId: string, key: 'org_admin' | 'access_admin' | 'auditor' | 'member') {
    await new RbacService().ensureSystemRoles(this.db, tenantId);
    const role = await this.db.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId, key } } });
    return role.id;
  }

  /** A custom role with exactly these permissions. */
  async customRole(tenantId: string, name: string, permissions: string[]) {
    const role = await this.db.role.create({
      data: {
        tenantId,
        key: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${randomUUID().slice(0, 6)}`,
        name,
        permissions: { create: permissions.map((permission) => ({ permission })) },
      },
    });
    return role.id;
  }

  async assign(
    tenantId: string,
    membershipId: string,
    roleId: string,
    scope: { type: 'TENANT' | 'COMPANY' | 'BRANCH' | 'DEPARTMENT'; id: string } = {
      type: 'TENANT',
      id: tenantId,
    },
  ) {
    return this.db.roleAssignment.create({
      data: { tenantId, membershipId, roleId, scopeType: scope.type, scopeId: scope.id },
    });
  }

  async company(tenantId: string, code: string) {
    return this.db.company.create({
      data: {
        tenantId,
        code: `${code}-${this.run}`.toUpperCase(),
        name: code,
        country: 'IN',
        baseCurrency: 'INR',
        timezone: 'Asia/Kolkata',
      },
    });
  }

  async cleanup(): Promise<void> {
    // audit_event is append-only by design and keeps no foreign keys, so its rows stay.
    const inTenants = { tenantId: { in: this.tenants } };
    await this.db.notification.deleteMany({ where: inTenants });
    await this.db.lookupValue.deleteMany({ where: inTenants });
    await this.db.notificationPreference.deleteMany({ where: inTenants });
    await this.db.approvalTask.deleteMany({ where: inTenants });
    await this.db.approvalRequest.deleteMany({ where: inTenants });
    await this.db.approvalDelegation.deleteMany({ where: inTenants });
    await this.db.approvalPolicy.deleteMany({ where: inTenants });
    await this.db.roleAssignment.deleteMany({ where: inTenants });
    await this.db.rolePermission.deleteMany({ where: inTenants });
    await this.db.role.deleteMany({ where: inTenants });
    // Children before parents.
    for (let i = 0; i < 10 && (await this.db.department.count({ where: inTenants })) > 0; i++) {
      await this.db.department.deleteMany({ where: { ...inTenants, children: { none: {} } } });
    }
    await this.db.branch.deleteMany({ where: inTenants });
    await this.db.company.deleteMany({ where: inTenants });
    await this.db.tenantSetting.deleteMany({ where: { tenantId: { in: this.tenants } } });
    await this.db.tenantMembership.deleteMany({
      where: { OR: [{ tenantId: { in: this.tenants } }, { userId: { in: this.users } }] },
    });
    await this.db.user.deleteMany({ where: { id: { in: this.users } } });
    await this.db.tenant.deleteMany({ where: { id: { in: this.tenants } } });
  }
}

/** Reads a cookie value from a supertest response's Set-Cookie headers. */
export function cookieFrom(res: request.Response, name: string): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const line = header?.find((c) => c.startsWith(`${name}=`));
  return line ? decodeURIComponent(line.split(';')[0]!.slice(name.length + 1)) : undefined;
}

export function setCookieLine(res: request.Response, name: string): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((c) => c.startsWith(`${name}=`));
}

/** A browser-like client: keeps cookies and sends the CSRF header on unsafe requests. */
export class Browser {
  readonly agent: ReturnType<typeof request.agent>;
  csrf: string | undefined;
  session: string | undefined;

  constructor(app: NestExpressApplication) {
    this.agent = request.agent(app.getHttpServer());
  }

  private remember(res: request.Response): request.Response {
    this.csrf = cookieFrom(res, 'shr_csrf') ?? this.csrf;
    this.session = cookieFrom(res, 'shr_session') ?? this.session;
    return res;
  }

  async get(path: string) {
    return this.remember(await this.agent.get(path).set('Origin', WEB_ORIGIN));
  }

  async send(
    method: 'post' | 'put' | 'patch' | 'delete',
    path: string,
    body?: object,
    headers: Record<string, string> = {},
  ) {
    let req = this.agent[method](path).set('Origin', WEB_ORIGIN);
    if (this.csrf) req = req.set('x-csrf-token', this.csrf);
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    return this.remember(await (body ? req.send(body) : req));
  }

  async login(email: string, password = DEFAULT_PASSWORD) {
    return this.send('post', '/v1/auth/login', { email, password });
  }
}

/** Reads emails the API queued for the worker, as the worker would receive them. */
export async function queuedEmails(env: ApiEnv, to: string): Promise<EmailJobData[]> {
  const queue = new Queue<EmailJobData>(QUEUES.notifications, {
    prefix: env.QUEUE_PREFIX,
    connection: { url: env.REDIS_URL },
  });
  try {
    const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized']);
    return jobs.filter((j) => j.name === NotificationJob.Email && j.data.to === to).map((j) => j.data);
  } finally {
    await queue.close();
  }
}

export function resetTokenFrom(email: EmailJobData): string {
  const match = /token=([A-Za-z0-9_-]+)/.exec(email.text);
  if (!match?.[1]) throw new Error('No reset link in email');
  return match[1];
}

export function decryptTotpSecret(sealed: string, userId: string): string {
  return new SecretBox({ t1: MFA_KEY }, 't1').decrypt(sealed, userId);
}
