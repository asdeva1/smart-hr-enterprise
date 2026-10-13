import { Controller, Get, HttpCode, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { pingDatabase, type DatabaseClient } from '@smart-hr/database';
import type { Response } from 'express';
import { Redis } from 'ioredis';
import { Public } from '../auth/auth.decorators.js';
import { DATABASE, REDIS } from '../infra/tokens.js';

type CheckStatus = 'up' | 'down';

export interface ReadinessReport {
  status: 'ok' | 'unavailable';
  checks: { database: CheckStatus; redis: CheckStatus };
}

const CHECK_TIMEOUT_MS = 2_000;

async function probe(check: () => Promise<unknown>): Promise<CheckStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([check(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Liveness: the process is running. Never touches dependencies, so restarts aren't triggered by an outage elsewhere. */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Process is alive' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: dependencies answer, so the load balancer may send traffic. */
  @Get('ready')
  @ApiOkResponse({ description: 'Database and Redis reachable' })
  @ApiServiceUnavailableResponse({ description: 'A dependency is unreachable' })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessReport> {
    const [database, redis] = await Promise.all([
      probe(() => pingDatabase(this.db)),
      probe(async () => {
        if (this.redis.status === 'wait') await this.redis.connect();
        return this.redis.ping();
      }),
    ]);
    const healthy = database === 'up' && redis === 'up';
    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: healthy ? 'ok' : 'unavailable', checks: { database, redis } };
  }
}
