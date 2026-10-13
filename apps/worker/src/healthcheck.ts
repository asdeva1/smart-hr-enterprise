/**
 * Container health check: exits 0 if a heartbeat was processed within three intervals, else 1.
 * Used by the ECS task definition, which has no HTTP port for the worker.
 */
import { Redis } from 'ioredis';
import { heartbeatKey, loadWorkerEnv } from './config/env.js';

const env = loadWorkerEnv();
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 2_000 });

async function isHealthy(): Promise<boolean> {
  try {
    const last = Number(await redis.get(heartbeatKey(env.QUEUE_PREFIX)));
    return Number.isFinite(last) && Date.now() - last < env.HEARTBEAT_INTERVAL_MS * 3;
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}

process.exit((await isHealthy()) ? 0 : 1);
