import { ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';

/**
 * Fixed-window rate limiting backed by Redis so limits are shared across API instances.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string) {
    const blockKey = `ratelimit:block:${throttlerName}:${key}`;
    const blockTtl = await this.redis.pttl(blockKey);
    if (blockTtl > 0) {
      return { totalHits: limit + 1, timeToExpire: Math.ceil(blockTtl / 1000), isBlocked: true, timeToBlockExpire: Math.ceil(blockTtl / 1000) };
    }

    const hitKey = `ratelimit:hits:${throttlerName}:${key}`;
    const [[, hits], [, pttl]] = (await this.redis.multi().incr(hitKey).pttl(hitKey).exec()) as [[null, number], [null, number]];
    let remainingMs = pttl;
    if (pttl < 0) {
      await this.redis.pexpire(hitKey, ttl);
      remainingMs = ttl;
    }

    const isBlocked = hits > limit;
    if (isBlocked) await this.redis.set(blockKey, '1', 'PX', blockDuration > 0 ? blockDuration : remainingMs);
    const timeToExpire = Math.ceil(remainingMs / 1000);
    return { totalHits: hits, timeToExpire, isBlocked, timeToBlockExpire: isBlocked ? timeToExpire : 0 };
  }
}
