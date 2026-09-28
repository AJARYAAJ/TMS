import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { loadConfig } from '../config';

export const REDIS = Symbol('REDIS');

@Injectable()
class RedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onApplicationShutdown() {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

/** Shared Redis client (rate limiting, cache, ephemeral state). */
@Global()
@Module({
  providers: [{ provide: REDIS, useFactory: () => new Redis(loadConfig().redisUrl, { maxRetriesPerRequest: 2 }) }, RedisShutdown],
  exports: [REDIS],
})
export class RedisModule {}
