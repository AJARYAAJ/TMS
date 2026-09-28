export interface AppConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  jwtTtl: string;
  corsOrigins: string[];
  storageRoot: string;
  storageSigningSecret: string;
  storageUrlTtlSeconds: number;
  maxUploadBytes: number;
  rateLimitPerMinute: number;
  realtimeRedisAdapter: boolean;
  queuePrefix: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL ?? 'postgres://workora:workora@localhost:5432/workora',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    jwtSecret: env.JWT_SECRET ?? 'dev-only-secret-change-me',
    jwtTtl: env.JWT_TTL ?? '12h',
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((o) => o.trim()),
    storageRoot: env.STORAGE_ROOT ?? './data/uploads',
    storageSigningSecret: env.STORAGE_SIGNING_SECRET ?? 'dev-only-storage-secret',
    storageUrlTtlSeconds: Number(env.STORAGE_URL_TTL_SECONDS ?? 900),
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024),
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 600),
    realtimeRedisAdapter: (env.REALTIME_REDIS_ADAPTER ?? 'true') !== 'false',
    queuePrefix: env.QUEUE_PREFIX ?? 'workora',
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
