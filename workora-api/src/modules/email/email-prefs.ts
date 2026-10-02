import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Kinds of notification. Each one can be switched on or off separately for email (`default`) and for
 * desktop notifications. In-app notifications (bell and Inbox) always arrive.
 */
export const EMAIL_CATEGORIES = {
  assigned: { label: 'Assigned to me', description: 'Someone assigns a task to you or takes you off one', reason: 'a task was assigned to you', default: true },
  mentioned: { label: '@mentions', description: 'Someone @mentions you in a comment', reason: 'someone mentioned you', default: true },
  overdue: { label: 'Overdue reminders', description: 'A task assigned to you passes its due date', reason: 'a task assigned to you is overdue', default: true },
  dueSoon: { label: 'Due tomorrow', description: 'A reminder the day before a task assigned to you is due', reason: 'a task assigned to you is due tomorrow', default: true },
  automation: { label: 'Automation alerts', description: 'An automation rule is set to notify you', reason: 'an automation rule notifies you', default: true },
  workspace: { label: 'Added to a workspace', description: 'You are added to a workspace', reason: 'you were added to a workspace', default: true },
  forms: { label: 'Form responses', description: 'Someone submits a form you created', reason: 'you created this form', default: true },
  comments: { label: 'Comments on tasks I watch', description: 'New comments on tasks you watch, own or reported', reason: 'you watch this task', default: false },
  status: { label: 'Status changes on tasks I watch', description: 'Tasks you watch or reported change state', reason: 'you watch this task', default: false },
  changes: { label: 'Other changes to my tasks', description: 'Priority, due date, files, blockers, trash and restore on tasks you watch', reason: 'you watch this task', default: false },
  development: { label: 'GitHub activity', description: 'Pull requests, commits and issues linked to tasks you watch', reason: 'you watch this task', default: false },
  sprints: { label: 'Sprint started / completed', description: 'A sprint you have work in starts or completes', reason: 'you have work in this sprint', default: false },
  goals: { label: 'Goals I own', description: 'Someone else updates a goal you own', reason: 'you own this goal', default: false },
} as const;

export type EmailCategory = keyof typeof EMAIL_CATEGORIES;
export const isEmailCategory = (c: string): c is EmailCategory => Object.hasOwn(EMAIL_CATEGORIES, c);
/** Security notices (2FA turned on/off) can't be switched off; their email is sent separately. */
export type NotificationCategory = EmailCategory | 'security';

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

/** Desktop notification preferences: sparse overrides like email, but every category defaults to on. */
export function effectivePushPrefs(raw: Record<string, boolean> | null | undefined): EmailPreferences {
  const r = raw ?? {};
  const categories = Object.fromEntries((Object.keys(EMAIL_CATEGORIES) as EmailCategory[]).map((c) => [c, r[c] !== false])) as Record<EmailCategory, boolean>;
  return { enabled: r.enabled !== false, categories };
}

export const wantsPush = (raw: Record<string, boolean> | null | undefined, category: NotificationCategory) => {
  if (category === 'security') return true;
  const p = effectivePushPrefs(raw);
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
