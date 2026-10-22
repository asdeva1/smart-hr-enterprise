import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { hashToken } from '@smart-hr/auth';
import { Redis } from 'ioredis';
import { REDIS } from '../infra/tokens.js';

const MAX_ATTEMPTS = 5;

/**
 * Six-digit codes sent by email to confirm a sensitive change, tied to one signed-in session. Only a hash is
 * kept, in Redis, so a code expires by itself, works once, and is dropped after a few wrong guesses.
 */
@Injectable()
export class OneTimeCodeService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private key(sessionId: string): string {
    return `otc:reauth:${sessionId}`;
  }

  /** A fresh code for this session; any earlier one stops working. */
  async issue(sessionId: string, ttlMinutes: number): Promise<string> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const key = this.key(sessionId);
    if (this.redis.status === 'wait') await this.redis.connect();
    await this.redis
      .multi()
      .hset(key, { hash: hashToken(`${sessionId}:${code}`), attempts: 0 })
      .expire(key, ttlMinutes * 60)
      .exec();
    return code;
  }

  /** True once per issued code. A wrong guess counts against a small allowance. */
  async verify(sessionId: string, code: string): Promise<boolean> {
    const key = this.key(sessionId);
    if (this.redis.status === 'wait') await this.redis.connect();
    const stored = await this.redis.hgetall(key);
    if (!stored.hash) return false;
    if (Number(stored.attempts ?? 0) >= MAX_ATTEMPTS) {
      await this.redis.del(key);
      return false;
    }
    if (stored.hash === hashToken(`${sessionId}:${code.trim()}`)) {
      await this.redis.del(key);
      return true;
    }
    await this.redis.hincrby(key, 'attempts', 1);
    return false;
  }
}
