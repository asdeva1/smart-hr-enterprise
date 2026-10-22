import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '@smart-hr/shared';
import type { ApiEnv } from '../config/env.js';
import { API_ENV } from '../infra/tokens.js';

export interface ProviderOrder {
  id: string;
}

/** HMAC-SHA256 in hex, compared in constant time. */
function signatureMatches(secret: string, payload: string | Buffer, given: string): boolean {
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(given.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Razorpay, spoken to over plain HTTPS so there is no SDK to keep current. We only ever create an order and
 * verify signatures: the customer pays inside Razorpay's own window, and card details never reach this server.
 */
@Injectable()
export class RazorpayProvider {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  get keyId(): string {
    return this.env.RAZORPAY_KEY_ID ?? '';
  }

  async createOrder(input: {
    amountMinor: number;
    currency: string;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<ProviderOrder> {
    const auth = Buffer.from(`${this.env.RAZORPAY_KEY_ID}:${this.env.RAZORPAY_KEY_SECRET}`).toString(
      'base64',
    );
    let res: Response;
    try {
      res = await fetch(`${this.env.RAZORPAY_API_BASE}/v1/orders`, {
        method: 'POST',
        headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          amount: input.amountMinor,
          currency: input.currency,
          receipt: input.receipt,
          notes: input.notes,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new AppError(
        'PAYMENT_UNAVAILABLE',
        'The payment service did not respond. Please try again.',
        502,
      );
    }
    if (!res.ok) {
      throw new AppError('PAYMENT_UNAVAILABLE', 'The payment service refused the request.', 502);
    }
    const body = (await res.json()) as { id?: unknown };
    if (typeof body.id !== 'string' || body.id.length === 0) {
      throw new AppError('PAYMENT_UNAVAILABLE', 'The payment service gave an unexpected answer.', 502);
    }
    return { id: body.id };
  }

  /** The browser's proof of payment: signature over `orderId|paymentId` with the key secret. */
  verifyPayment(providerOrderId: string, paymentId: string, signature: string): boolean {
    return signatureMatches(this.env.RAZORPAY_KEY_SECRET ?? '', `${providerOrderId}|${paymentId}`, signature);
  }

  /** The provider's own message to us: signature over the exact bytes received, with the webhook secret. */
  verifyWebhook(rawBody: Buffer, signature: string): boolean {
    return signatureMatches(this.env.RAZORPAY_WEBHOOK_SECRET ?? '', rawBody, signature);
  }
}
