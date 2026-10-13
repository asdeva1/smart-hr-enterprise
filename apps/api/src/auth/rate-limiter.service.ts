import { Inject, Injectable } from '@nestjs/common';
import { hashToken } from '@smart-hr/auth';
import { AppError } from '@smart-hr/shared';
import { Redis } from 'ioredis';
import { REDIS } from '../infra/tokens.js';

export class RateLimitedError extends AppError {
  constructor(public readonly retryAfterSeconds: number) {
    super('RATE_LIMITED', 'Too many attempts. Please wait a moment and try again.', 429);
  }
}

/**
 * Fixed-window counters in Redis. Keys are hashed, so emails and IPs are not stored in Redis in clear.
 * If Redis is unreachable the limiter fails closed for authentication endpoints: better to refuse
 * sign-in briefly than to allow unlimited guessing.
 */
@Injectable()
export class RateLimiterService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async consume(bucket: string, key: string, limit: number, windowSeconds: number): Promise<void> {
    const redisKey = `rl:${bucket}:${hashToken(key).slice(0, 32)}`;
    try {
      if (this.redis.status === 'wait') await this.redis.connect();
      const results = await this.redis
        .multi()
        .incr(redisKey)
        .expire(redisKey, windowSeconds, 'NX')
        .ttl(redisKey)
        .exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      const ttl = Number(results?.[2]?.[1] ?? windowSeconds);
      if (count > limit) throw new RateLimitedError(ttl > 0 ? ttl : windowSeconds);
    } catch (error) {
      if (error instanceof RateLimitedError) throw error;
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        'Sign-in is temporarily unavailable. Please try again shortly.',
        503,
      );
    }
  }

  /** Clears a counter, e.g. the per-email login counter after a successful sign-in. */
  async reset(bucket: string, key: string): Promise<void> {
    await this.redis.del(`rl:${bucket}:${hashToken(key).slice(0, 32)}`).catch(() => undefined);
  }
}
