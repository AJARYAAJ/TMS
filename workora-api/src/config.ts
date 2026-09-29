import 'dotenv/config';

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
  /** Allow webhooks to private/loopback addresses (disable in production to prevent SSRF). */
  webhookAllowPrivate: boolean;
  /** Public URL of the SPA, used for links in Slack messages and GitHub comments. */
  appUrl: string;
  /** Public base URL of the API (one-click unsubscribe links in emails). */
  apiPublicUrl: string;
  smtp: SmtpConfig;
}

export interface SmtpConfig {
  /** Unset → emails are rendered and logged but not sent. */
  host: string | null;
  port: number;
  /** Implicit TLS (port 465). Otherwise STARTTLS is used when the server offers it. */
  secure: boolean;
  user: string | null;
  pass: string | null;
  /** Refuse to send unless the connection is upgraded to TLS. */
  requireTls: boolean;
  /** Set false only for relays with self-signed certificates. */
  rejectUnauthorized: boolean;
  from: string;
}

/** SMTP settings from SMTP_URL (smtp[s]://user:pass@host:port) and/or discrete SMTP_* variables. */
function smtpConfig(env: NodeJS.ProcessEnv): SmtpConfig {
  const url = env.SMTP_URL ? new URL(env.SMTP_URL) : null;
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : url?.protocol === 'smtps:';
  return {
    host: env.SMTP_HOST || url?.hostname || null,
    port: Number(env.SMTP_PORT || url?.port || (secure ? 465 : 587)),
    secure,
    user: env.SMTP_USER || (url?.username ? decodeURIComponent(url.username) : null),
    pass: env.SMTP_PASS || (url?.password ? decodeURIComponent(url.password) : null),
    requireTls: env.SMTP_REQUIRE_TLS === 'true',
    rejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
    from: env.MAIL_FROM || 'Workora <no-reply@workora.dev>',
  };
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
    appUrl: (env.APP_URL ?? 'http://localhost:5173/workora').replace(/\/$/, ''),
    apiPublicUrl: (env.API_PUBLIC_URL ?? `${new URL(env.APP_URL ?? 'http://localhost:5173').origin}/api/v1`).replace(/\/$/, ''),
    smtp: smtpConfig(env),
    webhookAllowPrivate: (env.WEBHOOK_ALLOW_PRIVATE ?? (env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
