import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { normalizeEmail } from '@smart-hr/auth';
import { withContext, type DatabaseClient } from '@smart-hr/database';
import { AppError, NotFoundError } from '@smart-hr/shared';
import {
  isFreeEmailDomain,
  WORK_EMAIL_MESSAGE,
  minEmployeesFor,
  type checkoutSchema,
  type confirmCheckoutSchema,
} from '@smart-hr/validation';
import type { z } from 'zod';
import { AuditService, emailFingerprint } from '../audit/audit.service.js';
import { RateLimiterService } from '../auth/rate-limiter.service.js';
import type { RequestMeta } from '../common/request-context.js';
import type { ApiEnv } from '../config/env.js';
import { latestPublishedVersion } from '../entitlements/catalogue-sync.js';
import { InvitationService } from '../identity/invitation.service.js';
import { TenantProvisioner } from '../identity/tenant-provisioner.js';
import { API_ENV, DATABASE } from '../infra/tokens.js';
import { MailService } from '../notifications/mail.service.js';
import { slugFor } from '../signup/signup.service.js';
import { RazorpayProvider } from './razorpay.provider.js';

/** Plans that are not for sale: the demo is offered through its own button. */
const NOT_FOR_SALE = new Set(['DEMO']);
const CURRENCY = 'INR';

/** The end of a paid period, counted in calendar months so "monthly" lands on the same day next month. */
export function periodEnd(from: Date, period: 'MONTHLY' | 'ANNUAL'): Date {
  const end = new Date(from);
  end.setUTCMonth(end.getUTCMonth() + (period === 'ANNUAL' ? 12 : 1));
  return end;
}

/**
 * Buying a plan on the website, and creating the organisation when the payment is confirmed.
 *
 * Two messages can confirm a payment: the browser's (right after the customer pays) and the payment
 * provider's own signed webhook (which also arrives if the customer closes the window). Both end in `fulfil`,
 * which claims the order first, so however they race, one organisation is created and one email is sent.
 * Prices come from the live plan catalogue; the browser never says what something costs.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly provider: RazorpayProvider,
    private readonly limiter: RateLimiterService,
    private readonly provisioner: TenantProvisioner,
    private readonly invitations: InvitationService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  private requireEnabled() {
    if (!this.env.CHECKOUT_ENABLED) throw new NotFoundError('Page');
  }

  async start(input: z.output<typeof checkoutSchema>, meta: RequestMeta) {
    this.requireEnabled();
    const email = normalizeEmail(input.email);
    if (this.env.SIGNUP_BLOCK_FREE_EMAIL && isFreeEmailDomain(email)) {
      throw new AppError('WORK_EMAIL_REQUIRED', WORK_EMAIL_MESSAGE, 422, [
        { path: 'email', message: WORK_EMAIL_MESSAGE },
      ]);
    }
    await this.limiter.consume('checkout-ip', meta.ip ?? 'unknown', this.env.SIGNUP_RATE_LIMIT_PER_IP, 3600);
    await this.limiter.consume('checkout-email', email, this.env.SIGNUP_RATE_LIMIT_PER_EMAIL * 2, 3600);

    if (NOT_FOR_SALE.has(input.planCode)) throw new NotFoundError('Plan');
    const found = await withContext(this.db, { platformActor: true }, async (tx) => {
      const version = await latestPublishedVersion(tx, input.planCode);
      const plan = version
        ? await tx.plan.findUnique({ where: { id: version.planId }, select: { status: true } })
        : null;
      const price = version
        ? await tx.planPrice.findUnique({
            where: {
              planVersionId_currency_billingPeriod: {
                planVersionId: version.id,
                currency: CURRENCY,
                billingPeriod: input.billingPeriod,
              },
            },
          })
        : null;
      return { version, plan, price };
    });
    const { version, plan, price } = found;
    if (!version || plan?.status !== 'ACTIVE') throw new NotFoundError('Plan');
    if (!version.deploymentModels.includes('SAAS')) throw new NotFoundError('Plan');
    if (!price) {
      throw new AppError(
        'PRICE_NOT_AVAILABLE',
        'This plan can’t be bought online yet. Please contact us for a quote.',
        409,
      );
    }
    const quantity = price.pricingModel === 'FLAT' ? 1 : input.quantity;
    if (price.pricingModel === 'PER_EMPLOYEE' && quantity < minEmployeesFor(input.planCode)) {
      const min = minEmployeesFor(input.planCode);
      throw new AppError('BELOW_MINIMUM_EMPLOYEES', `This plan starts at ${min} employees.`, 400, [
        { path: 'quantity', message: `This plan starts at ${min} employees` },
      ]);
    }
    const amountMinor = price.amount.mul(quantity).mul(100).toDecimalPlaces(0).toNumber();
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 100 || amountMinor > 2_000_000_000) {
      throw new AppError('PRICE_NOT_AVAILABLE', 'This amount can’t be paid online. Please contact us.', 409);
    }

    const orderId = randomUUID();
    const remote = await this.provider.createOrder({
      amountMinor,
      currency: CURRENCY,
      receipt: orderId.slice(0, 36),
      notes: { plan: input.planCode, period: input.billingPeriod, quantity: String(quantity) },
    });
    await withContext(this.db, { platformActor: true }, (tx) =>
      tx.checkoutOrder.create({
        data: {
          id: orderId,
          email,
          displayName: input.displayName,
          organisationName: input.organisationName,
          planVersionId: version.id,
          billingPeriod: input.billingPeriod,
          quantity,
          licensedEmployees: price.pricingModel === 'PER_EMPLOYEE' ? quantity : null,
          currency: CURRENCY,
          amountMinor,
          providerOrderId: remote.id,
        },
      }),
    );
    await this.audit.record(
      {
        action: 'checkout.start',
        outcome: 'SUCCESS',
        metadata: { email: emailFingerprint(email), plan: input.planCode, amountMinor },
      },
      meta,
    );
    return {
      orderId,
      providerOrderId: remote.id,
      keyId: this.provider.keyId,
      amountMinor,
      currency: CURRENCY,
    };
  }

  /** The browser reports a finished payment. Its signature proves Razorpay issued this payment id. */
  async confirm(input: z.output<typeof confirmCheckoutSchema>, meta: RequestMeta) {
    this.requireEnabled();
    const order = await withContext(this.db, { platformActor: true }, (tx) =>
      tx.checkoutOrder.findUnique({ where: { id: input.orderId } }),
    );
    if (!order || !this.provider.verifyPayment(order.providerOrderId, input.paymentId, input.signature)) {
      throw new AppError('PAYMENT_NOT_VERIFIED', 'We could not verify this payment.', 400);
    }
    await this.fulfil(order.providerOrderId, input.paymentId, meta);
    return { status: 'paid' as const };
  }

  /** Razorpay's own message. Anything but a captured payment is acknowledged and ignored. */
  async webhook(rawBody: Buffer | undefined, signature: string | undefined, meta: RequestMeta) {
    this.requireEnabled();
    if (!rawBody || !signature || !this.provider.verifyWebhook(rawBody, signature)) {
      throw new AppError('INVALID_SIGNATURE', 'Signature check failed.', 400);
    }
    let event: {
      event?: string;
      payload?: { payment?: { entity?: { id?: string; order_id?: string; status?: string } } };
    };
    try {
      event = JSON.parse(rawBody.toString('utf8')) as typeof event;
    } catch {
      throw new AppError('INVALID_PAYLOAD', 'Unreadable event.', 400);
    }
    const payment = event.payload?.payment?.entity;
    if (
      (event.event === 'payment.captured' || event.event === 'order.paid') &&
      payment?.id &&
      payment.order_id &&
      (payment.status === undefined || payment.status === 'captured')
    ) {
      await this.fulfil(payment.order_id, payment.id, meta);
    }
    return { received: true };
  }

  /** Creates the organisation for a paid order, once. Safe to call any number of times, in any order. */
  async fulfil(providerOrderId: string, paymentId: string, meta: RequestMeta): Promise<void> {
    const outcome = await withContext(this.db, { platformActor: true }, async (tx) => {
      const order = await tx.checkoutOrder.findUnique({
        where: { providerOrderId },
        include: { planVersion: true },
      });
      if (!order) return null;
      // Claim first: a second message for the same order finds nothing to claim and stops here.
      const claimed = await tx.checkoutOrder.updateMany({
        where: { id: order.id, status: 'PENDING' },
        data: { status: 'PAID', providerPaymentId: paymentId, paidAt: new Date() },
      });
      if (claimed.count === 0) return null;

      const existing = await tx.user.findUnique({ where: { email: order.email } });
      const owner =
        existing ?? (await tx.user.create({ data: { email: order.email, displayName: order.displayName } }));
      const now = new Date();
      const { tenant } = await this.provisioner.create(tx, {
        name: order.organisationName,
        slug: slugFor(order.organisationName),
        ownerUserId: owner.id,
        plan: {
          version: order.planVersion,
          status: 'ACTIVE',
          currentPeriodEnd: periodEnd(now, order.billingPeriod),
        },
        actorUserId: owner.id,
        source: 'signup',
        meta,
      });
      await tx.subscription.update({
        where: { tenantId: tenant.id },
        data: {
          billingPeriod: order.billingPeriod,
          currency: order.currency,
          provider: order.provider,
          providerRef: paymentId,
          licensedEmployees: order.licensedEmployees,
        },
      });
      await tx.checkoutOrder.update({ where: { id: order.id }, data: { tenantId: tenant.id } });
      return {
        email: order.email,
        displayName: order.displayName,
        tenantName: tenant.name,
        userId: owner.id,
        needsPassword: owner.passwordHash === null,
        orderId: order.id,
        tenantId: tenant.id,
      };
    });
    if (!outcome) return;

    // After the organisation is safely committed. A failed email can be re-sent by an operator; the
    // organisation must not be rolled back for it.
    try {
      if (outcome.needsPassword) {
        await this.invitations.send(
          outcome.userId,
          outcome.email,
          outcome.displayName,
          outcome.tenantName,
          'Smart HR',
        );
      } else {
        await this.mail.send({
          to: outcome.email,
          category: 'checkout_ready',
          subject: `${outcome.tenantName} is ready on Smart HR`,
          text: [
            `Hello ${outcome.displayName},`,
            '',
            `Thank you. ${outcome.tenantName} has been created and is ready to use.`,
            `Sign in with your existing account and choose it: ${new URL('/login', this.env.APP_PUBLIC_URL).toString()}`,
          ].join('\n'),
        });
      }
    } catch (error) {
      this.logger.error(`Organisation ${outcome.tenantId} created but its email was not queued`, error);
    }
    await this.audit.record(
      {
        action: 'checkout.fulfilled',
        outcome: 'SUCCESS',
        tenantId: outcome.tenantId,
        metadata: { orderId: outcome.orderId, email: emailFingerprint(outcome.email) },
      },
      meta,
    );
  }
}
