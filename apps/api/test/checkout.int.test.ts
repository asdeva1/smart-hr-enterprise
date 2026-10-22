/**
 * Buying a plan on the website, through the real API and database, with a local stand-in for Razorpay:
 * prices come from the plan catalogue, a payment confirmed by the browser or by the provider's signed webhook
 * creates one organisation (however the two race), and forged or repeated messages change nothing.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiEnv } from '../src/config/env.js';
import { syncPlanCatalogue } from '../src/entitlements/catalogue-sync.js';
import { Browser, Fixtures, ownerClient, queuedEmails, startApp, testEnv } from './helpers.js';

const KEY_SECRET = 'test_key_secret_123';
const WEBHOOK_SECRET = 'test_webhook_secret_456';

const db = ownerClient();
const fx = new Fixtures(db);
let env: ApiEnv;
let app: NestExpressApplication;
let razorpay: Server;
let planCode: string;
let planId: string;
const providerOrders: { amount: number; currency: string }[] = [];

const sign = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest('hex');
const domain = () => `chk-${fx.run}.example.com`;

beforeAll(async () => {
  await syncPlanCatalogue(db);
  // A stand-in for Razorpay's order API: records what we asked for and answers with an order id.
  razorpay = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}') as { amount: number; currency: string };
      providerOrders.push(parsed);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: `order_${randomUUID().replace(/-/g, '').slice(0, 14)}` }));
    });
  });
  await new Promise<void>((resolve) => razorpay.listen(0, '127.0.0.1', resolve));
  const port = (razorpay.address() as AddressInfo).port;

  // A plan of our own, priced per employee, so the shared catalogue stays untouched.
  planCode = `CHK${fx.run
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 10)}`;
  const plan = await db.plan.create({ data: { code: planCode, name: 'Checkout test', sortOrder: 900 } });
  planId = plan.id;
  const version = await db.planVersion.create({
    data: {
      planId: plan.id,
      version: 1,
      status: 'DRAFT',
      features: ['hr.core', 'leave.basic'],
      limits: { 'users.max': 10 },
      trialDays: 0,
      graceDays: 7,
      deploymentModels: ['SAAS'],
      prices: {
        create: [
          { currency: 'INR', billingPeriod: 'MONTHLY', pricingModel: 'PER_EMPLOYEE', amount: '99.50' },
          { currency: 'INR', billingPeriod: 'ANNUAL', pricingModel: 'FLAT', amount: '9999' },
        ],
      },
    },
  });
  await db.planVersion.update({
    where: { id: version.id },
    data: { status: 'PUBLISHED', publishedAt: new Date() },
  });

  env = testEnv({
    SIGNUP_ENABLED: 'true',
    SIGNUP_RATE_LIMIT_PER_IP: '100000',
    SIGNUP_RATE_LIMIT_PER_EMAIL: '100000',
    CHECKOUT_ENABLED: 'true',
    RAZORPAY_KEY_ID: 'rzp_test_key',
    RAZORPAY_KEY_SECRET: KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    RAZORPAY_API_BASE: `http://127.0.0.1:${port}`,
  });
  app = await startApp(env);
});

afterAll(async () => {
  await app?.close();
  await new Promise((resolve) => razorpay?.close(resolve));
  const orders = await db.checkoutOrder.findMany({ where: { email: { contains: fx.run } } });
  for (const o of orders) if (o.tenantId) fx.trackTenant(o.tenantId);
  const users = await db.user.findMany({ where: { email: { contains: fx.run } } });
  for (const u of users) fx.trackUser(u.id);
  // Orders and tenants are removed with the fixtures.
  await db.checkoutOrder.deleteMany({ where: { email: { contains: fx.run } } });
  await fx.cleanup();
  // Published plans are permanent by design, so this test's plan is retired and archived, not deleted: it
  // no longer sells and drops out of the public list.
  await db.planVersion.updateMany({ where: { planId }, data: { status: 'RETIRED', retiredAt: new Date() } });
  await db.plan.update({ where: { id: planId }, data: { status: 'ARCHIVED' } });
  await db.$disconnect();
});

function buy(overrides: Record<string, unknown> = {}) {
  return new Browser(app).send('post', '/v1/checkout', {
    planCode,
    billingPeriod: 'MONTHLY',
    quantity: 20,
    organisationName: 'Globex Industries',
    displayName: 'Gus Founder',
    email: `owner-${randomUUID().slice(0, 8)}-${fx.run}@${domain()}`,
    ...overrides,
  });
}

function pay(orderId: string, providerOrderId: string, paymentId = `pay_${randomUUID().slice(0, 12)}`) {
  return {
    orderId,
    paymentId,
    signature: sign(KEY_SECRET, `${providerOrderId}|${paymentId}`),
  };
}

/** Sends a provider event, signed over the exact bytes that go on the wire. */
function webhook(event: object, secret: string | null = WEBHOOK_SECRET) {
  return new Browser(app).send(
    'post',
    '/v1/billing/webhook',
    event,
    secret === null ? {} : { 'x-razorpay-signature': sign(secret, JSON.stringify(event)) },
  );
}

const captured = (paymentId: string, providerOrderId: string) => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id: paymentId, order_id: providerOrderId, status: 'captured' } } },
});

const tenantsFor = (email: string) =>
  db.tenantMembership.findMany({ where: { user: { email } }, select: { tenantId: true } });

describe('starting a purchase', () => {
  it('asks for a company address', async () => {
    const res = await buy({ email: `x-${fx.run}@gmail.com` });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('WORK_EMAIL_REQUIRED');
  });

  it('does not sell the demo, an unknown plan, or a plan without a price', async () => {
    expect((await buy({ planCode: 'DEMO' })).status).toBe(404);
    expect((await buy({ planCode: 'NOPE' })).status).toBe(404);
    const unpriced = await buy({ planCode: 'LITE' });
    expect(unpriced.status).toBe(409);
    expect(unpriced.body.code).toBe('PRICE_NOT_AVAILABLE');
  });

  it('prices the order from the catalogue, ignoring any amount from the browser', async () => {
    providerOrders.length = 0;
    const res = await buy({ quantity: 20, amount: 1, amountMinor: 1 });
    expect(res.status).toBe(201);
    // 20 employees x 99.50 rupees = 1990 rupees = 199000 paise
    expect(res.body).toMatchObject({ amountMinor: 199_000, currency: 'INR', keyId: 'rzp_test_key' });
    expect(providerOrders.at(-1)).toMatchObject({ amount: 199_000, currency: 'INR' });
    const order = await db.checkoutOrder.findUniqueOrThrow({ where: { id: res.body.orderId } });
    expect(order).toMatchObject({ status: 'PENDING', tenantId: null, quantity: 20 });

    const flat = await buy({ billingPeriod: 'ANNUAL', quantity: 500 });
    expect(flat.body.amountMinor).toBe(999_900); // flat: quantity is ignored
  });
});

describe('confirming a payment', () => {
  it('refuses a forged browser confirmation and creates nothing', async () => {
    const started = await buy();
    const email = (await db.checkoutOrder.findUniqueOrThrow({ where: { id: started.body.orderId } })).email;
    const res = await new Browser(app).send('post', '/v1/checkout/confirm', {
      orderId: started.body.orderId,
      paymentId: 'pay_forged00001',
      signature: sign('some-other-secret', `${started.body.providerOrderId}|pay_forged00001`),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PAYMENT_NOT_VERIFIED');
    expect(await tenantsFor(email)).toHaveLength(0);
    expect((await db.checkoutOrder.findUniqueOrThrow({ where: { id: started.body.orderId } })).status).toBe(
      'PENDING',
    );
  });

  it('creates the organisation on an active subscription, and invites the owner to set a password', async () => {
    const started = await buy({ organisationName: 'Hooli Works' });
    const order = await db.checkoutOrder.findUniqueOrThrow({ where: { id: started.body.orderId } });
    const body = pay(order.id, order.providerOrderId);
    const res = await new Browser(app).send('post', '/v1/checkout/confirm', body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'paid' });

    const [membership] = await tenantsFor(order.email);
    expect(membership).toBeDefined();
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: membership!.tenantId } });
    expect(tenant.name).toBe('Hooli Works');
    const sub = await db.subscription.findUniqueOrThrow({
      where: { tenantId: tenant.id },
      include: { planVersion: { include: { plan: true } } },
    });
    expect(sub).toMatchObject({
      status: 'ACTIVE',
      provider: 'razorpay',
      providerRef: body.paymentId,
      billingPeriod: 'MONTHLY',
      licensedEmployees: 20, // per-employee price: the 20 employees bought are the organisation's limit
      planVersion: { plan: { code: planCode } },
    });
    expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now() + 27 * 86_400_000);
    const paid = await db.checkoutOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid).toMatchObject({ status: 'PAID', tenantId: tenant.id, providerPaymentId: body.paymentId });
    const owner = await db.user.findUniqueOrThrow({ where: { email: order.email } });
    expect(owner.passwordHash).toBeNull();
    expect(await queuedEmails(env, order.email)).toHaveLength(1);
  });

  it('does nothing more when the same payment is reported again, by the browser or the webhook', async () => {
    const started = await buy({ organisationName: 'Pied Piper' });
    const order = await db.checkoutOrder.findUniqueOrThrow({ where: { id: started.body.orderId } });
    const body = pay(order.id, order.providerOrderId);
    const first = await new Browser(app).send('post', '/v1/checkout/confirm', body);
    expect(first.status).toBe(200);

    const again = await new Browser(app).send('post', '/v1/checkout/confirm', body);
    expect(again.status).toBe(200);
    const hook = await webhook(captured(body.paymentId, order.providerOrderId));
    expect(hook.status).toBe(200);

    expect(await tenantsFor(order.email)).toHaveLength(1);
    expect(await queuedEmails(env, order.email)).toHaveLength(1);
  });
});

describe('the provider webhook', () => {
  it('refuses a bad or missing signature', async () => {
    const event = { event: 'payment.captured', payload: {} };
    expect((await webhook(event, 'wrong')).status).toBe(400);
    expect((await webhook(event, null)).status).toBe(400);
  });

  it('creates the organisation when the customer closes the window but the payment is captured', async () => {
    const started = await buy({ organisationName: 'Initrode' });
    const order = await db.checkoutOrder.findUniqueOrThrow({ where: { id: started.body.orderId } });
    const res = await webhook(captured('pay_webhookonly1', order.providerOrderId));
    expect(res.status).toBe(200);
    expect(await tenantsFor(order.email)).toHaveLength(1);
    expect((await db.checkoutOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID');
  });

  it('acknowledges and ignores events that are not a captured payment', async () => {
    const started = await buy({ organisationName: 'Soylent' });
    const order = await db.checkoutOrder.findUniqueOrThrow({ where: { id: started.body.orderId } });
    const res = await webhook({
      event: 'payment.failed',
      payload: {
        payment: { entity: { id: 'pay_failed000001', order_id: order.providerOrderId, status: 'failed' } },
      },
    });
    expect(res.status).toBe(200);
    expect(await tenantsFor(order.email)).toHaveLength(0);
  });
});

describe('when online purchase is off', () => {
  it('is not found', async () => {
    const closed = await startApp(testEnv());
    try {
      const res = await new Browser(closed).send('post', '/v1/checkout', {
        planCode,
        billingPeriod: 'MONTHLY',
        organisationName: 'Nope',
        displayName: 'Nope',
        email: `nope-${fx.run}@${domain()}`,
      });
      expect(res.status).toBe(404);
    } finally {
      await closed.close();
    }
  });
});

describe('contact us', () => {
  const enquiry = (overrides: Record<string, unknown> = {}) => ({
    name: 'Ira Buyer',
    email: `ira-${fx.run}@${domain()}`,
    company: 'Umbrella Corp',
    interest: 'PRICING',
    message: 'We have 400 people. Please send a quote.',
    ...overrides,
  });

  it('is not found until a sales address is set', async () => {
    const res = await new Browser(app).send('post', '/v1/public/contact', enquiry());
    expect(res.status).toBe(404);
  });

  it('emails the sales inbox, keeps a pasted newline out of the subject, and rejects bad input', async () => {
    const sales = `sales-${fx.run}@${domain()}`;
    const salesEnv = testEnv({
      SALES_CONTACT_EMAIL: sales,
      SIGNUP_RATE_LIMIT_PER_IP: '100000',
      SIGNUP_RATE_LIMIT_PER_EMAIL: '100000',
    });
    const withSales = await startApp(salesEnv);
    try {
      const ok = await new Browser(withSales).send(
        'post',
        '/v1/public/contact',
        enquiry({ company: 'Umbrella\nBcc: spy@example.com' }),
      );
      expect(ok.status).toBe(202);
      const mails = await queuedEmails(salesEnv, sales);
      expect(mails).toHaveLength(1);
      expect(mails[0]!.subject).not.toMatch(/[\r\n]/);
      expect(mails[0]!.subject).toContain('Umbrella Bcc: spy@example.com');
      expect(mails[0]!.text).toContain('We have 400 people');

      const bad = await new Browser(withSales).send('post', '/v1/public/contact', enquiry({ email: 'nope' }));
      expect(bad.status).toBe(400);
      expect((await queuedEmails(salesEnv, sales)).length).toBe(1);
    } finally {
      await withSales.close();
    }
  });
});
