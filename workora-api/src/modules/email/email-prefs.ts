import { createHmac, timingSafeEqual } from 'crypto';

/** Kinds of notification email. Users can switch each one off, or all email at once. */
export const EMAIL_CATEGORIES = {
  assigned: { label: 'Assigned to me', description: 'Someone assigns a task to you', reason: 'a task was assigned to you', default: true },
  mentioned: { label: '@mentions', description: 'Someone @mentions you in a comment', reason: 'someone mentioned you', default: true },
  overdue: { label: 'Overdue reminders', description: 'A task assigned to you passes its due date', reason: 'a task assigned to you is overdue', default: true },
  automation: { label: 'Automation alerts', description: 'An automation rule is set to notify you', reason: 'an automation rule notifies you', default: true },
  workspace: { label: 'Added to a workspace', description: 'You are added to a workspace', reason: 'you were added to a workspace', default: true },
  comments: { label: 'Comments on tasks I watch', description: 'New comments on tasks you watch, own or reported', reason: 'you watch this task', default: false },
  status: { label: 'Status changes on tasks I watch', description: 'Tasks you watch or reported change state', reason: 'you watch this task', default: false },
  sprints: { label: 'Sprint started / completed', description: 'A sprint you have work in starts or completes', reason: 'you have work in this sprint', default: false },
} as const;

export type EmailCategory = keyof typeof EMAIL_CATEGORIES;
export const isEmailCategory = (c: string): c is EmailCategory => Object.hasOwn(EMAIL_CATEGORIES, c);

export interface EmailPreferences {
  enabled: boolean;
  categories: Record<EmailCategory, boolean>;
}

/** Stored prefs are sparse overrides: `{ enabled?: boolean, <category>?: boolean }`. */
export function effectivePrefs(raw: Record<string, boolean> | null | undefined): EmailPreferences {
  const r = raw ?? {};
  const categories = Object.fromEntries(
    (Object.keys(EMAIL_CATEGORIES) as EmailCategory[]).map((c) => [c, typeof r[c] === 'boolean' ? r[c] : EMAIL_CATEGORIES[c].default]),
  ) as Record<EmailCategory, boolean>;
  return { enabled: r.enabled !== false, categories };
}

export const wantsEmail = (raw: Record<string, boolean> | null | undefined, category: EmailCategory) => {
  const p = effectivePrefs(raw);
  return p.enabled && p.categories[category];
};

/**
 * Unsubscribe tokens: `<base64url(userId:category)>.<hmac>`. They never expire, so links in old
 * emails keep working, and they only ever switch email *off*.
 */
export class UnsubscribeTokens {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHmac('sha256', secret).update('workora:email-unsubscribe').digest();
  }

  sign(userId: string, category: EmailCategory | 'all') {
    const payload = Buffer.from(`${userId}:${category}`).toString('base64url');
    return `${payload}.${this.mac(payload)}`;
  }

  verify(token: string): { userId: string; category: EmailCategory | 'all' } | null {
    const [payload, mac] = String(token ?? '').split('.');
    if (!payload || !mac) return null;
    const expected = Buffer.from(this.mac(payload));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const [userId, category] = Buffer.from(payload, 'base64url').toString().split(':');
    if (!/^[0-9a-f-]{36}$/i.test(userId ?? '') || !(category === 'all' || isEmailCategory(category ?? ''))) return null;
    return { userId, category: category as EmailCategory | 'all' };
  }

  private mac(payload: string) {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}
