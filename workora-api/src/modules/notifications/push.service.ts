import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import webpush, { WebPushError } from 'web-push';
import { SecretBox } from '../../common/crypto/secret-box';
import { ApiException } from '../../common/http/api-exception';
import { APP_CONFIG, AppConfig } from '../../config';

export interface PushMessage {
  /** Notification id (or "test"); also the tag, so a repeat replaces instead of stacking. */
  id: string;
  title: string;
  body?: string;
  /** Absolute URL opened when the notification is clicked. */
  url: string;
  category: string;
  organization?: string;
}

/** Push services browsers use today. In production, subscriptions must point at one of them (no SSRF). */
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com', 'push.apple.com'];
const MAX_FAILURES = 10;

/**
 * Web Push (RFC 8030 + VAPID RFC 8292 + aes128gcm RFC 8291). Each browser that turned on desktop
 * notifications is a row in push_subscriptions; messages are encrypted end-to-end to that browser.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private keys: Promise<{ publicKey: string; privateKey: string }> | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly box: SecretBox,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The VAPID key pair: from the environment, or generated once and stored sealed in app_secrets. */
  vapidKeys() {
    this.keys ??= this.loadKeys().catch((e) => {
      this.keys = null;
      throw e;
    });
    return this.keys;
  }

  private async loadKeys() {
    const { publicKey, privateKey } = this.config.push;
    if (publicKey && privateKey) return { publicKey, privateKey };
    const generated = webpush.generateVAPIDKeys();
    // ON CONFLICT: several API instances may start at once; the first one's keys win.
    await this.dataSource.query(`INSERT INTO app_secrets (name, value) VALUES ('vapid', $1) ON CONFLICT (name) DO NOTHING`, [this.box.seal(JSON.stringify(generated))]);
    const [row] = await this.dataSource.query(`SELECT value FROM app_secrets WHERE name = 'vapid'`);
    return JSON.parse(this.box.open(row.value)) as { publicKey: string; privateKey: string };
  }

  assertEndpoint(endpoint: string) {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw ApiException.badRequest('INVALID_SUBSCRIPTION', 'The push endpoint is not a valid URL');
    }
    if (url.protocol !== 'https:') throw ApiException.badRequest('INVALID_SUBSCRIPTION', 'The push endpoint must use https');
    // Development and tests may use a local push service; production only talks to the real ones.
    if (this.config.webhookAllowPrivate) return;
    if (!PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) throw ApiException.badRequest('INVALID_SUBSCRIPTION', 'This browser uses a push service Workora does not support');
  }

  async subscribe(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, device: string) {
    this.assertEndpoint(sub.endpoint);
    // The same browser may have been used by someone else before: the endpoint moves to the current user.
    await this.dataSource.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4, device = $5, failures = 0`,
      [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, device.slice(0, 120)],
    );
  }

  async unsubscribe(userId: string, endpoint: string) {
    const [, removed] = await this.dataSource.query(`DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`, [userId, endpoint]);
    return removed as number;
  }

  async devices(userId: string) {
    const rows: { endpoint: string; device: string; created_at: Date; last_success_at: Date | null }[] = await this.dataSource.query(
      `SELECT endpoint, device, created_at, last_success_at FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    );
    return rows.map((r) => ({ endpoint: r.endpoint, device: r.device, createdAt: r.created_at, lastSuccessAt: r.last_success_at }));
  }

  /** Sends to every browser the user turned desktop notifications on in. Never throws. */
  async send(userId: string, message: PushMessage): Promise<{ sent: number; failed: number }> {
    const subs: { id: string; endpoint: string; p256dh: string; auth: string }[] = await this.dataSource.query(
      `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
      [userId],
    );
    if (!subs.length) return { sent: 0, failed: 0 };
    let keys: { publicKey: string; privateKey: string };
    try {
      keys = await this.vapidKeys();
    } catch (e) {
      this.logger.error('Could not load VAPID keys', e instanceof Error ? e.stack : e);
      return { sent: 0, failed: subs.length };
    }
    const payload = JSON.stringify({ ...message, body: message.body?.slice(0, 300) });
    const urgent = ['mentioned', 'assigned', 'security', 'overdue'].includes(message.category);
    const results = await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
            vapidDetails: { subject: this.config.push.subject, ...keys },
            TTL: 24 * 3600,
            urgency: urgent ? 'high' : 'normal',
            timeout: 10_000,
          });
          await this.dataSource.query(`UPDATE push_subscriptions SET last_success_at = now(), failures = 0 WHERE id = $1`, [s.id]);
          return true;
        } catch (e) {
          const status = e instanceof WebPushError ? e.statusCode : 0;
          // 404/410: the browser unsubscribed or the subscription expired. Repeated failures: give up on it.
          if (status === 404 || status === 410) await this.dataSource.query(`DELETE FROM push_subscriptions WHERE id = $1`, [s.id]);
          else {
            const [rows] = await this.dataSource.query(`UPDATE push_subscriptions SET failures = failures + 1 WHERE id = $1 RETURNING failures`, [s.id]);
            if (rows?.[0]?.failures >= MAX_FAILURES) await this.dataSource.query(`DELETE FROM push_subscriptions WHERE id = $1`, [s.id]);
          }
          this.logger.warn(`Push to ${new URL(s.endpoint).host} failed (${status || (e as Error).message})`);
          return false;
        }
      }),
    );
    const sent = results.filter(Boolean).length;
    return { sent, failed: results.length - sent };
  }
}
