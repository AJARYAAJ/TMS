/**
 * Recurrence rules for repeating tasks. When a recurring task is completed, the next
 * occurrence is created with its dates advanced by the rule. Dates are calendar dates
 * (YYYY-MM-DD) computed in UTC so time zones never shift a day.
 */
export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface RecurrenceRule {
  freq: Frequency;
  /** Every N days/weeks/months/years (default 1). */
  interval?: number;
  /** WEEKLY only: 0 = Sunday … 6 = Saturday. Defaults to the weekday of the base date. */
  byWeekday?: number[];
  /** No occurrences after this date. */
  endDate?: string | null;
}

const toDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
/** Monday-based week index, used to honour "every N weeks". */
const weekIndex = (d: Date) => Math.floor((d.getTime() / 86_400_000 + 3) / 7);

function addMonths(base: Date, months: number, day: number) {
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth() + months;
  const target = new Date(Date.UTC(y, m, 1));
  const clamped = Math.min(day, daysInMonth(target.getUTCFullYear(), target.getUTCMonth()));
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), clamped));
}

/** The first occurrence strictly after `after`, following `rule` anchored at `anchor`. */
function step(rule: RecurrenceRule, after: Date, anchor: Date): Date {
  const n = Math.max(1, Math.floor(rule.interval ?? 1));
  switch (rule.freq) {
    case 'DAILY':
      return addDays(after, n);
    case 'WEEKLY': {
      const days = rule.byWeekday?.length ? rule.byWeekday : [anchor.getUTCDay()];
      for (let i = 1; i <= 7 * n + 7; i++) {
        const d = addDays(after, i);
        if (days.includes(d.getUTCDay()) && (weekIndex(d) - weekIndex(anchor)) % n === 0) return d;
      }
      return addDays(after, 7 * n);
    }
    case 'MONTHLY': {
      // Keep the anchor's day of month (31st → last day of shorter months).
      let months = n;
      let d = addMonths(after, months, anchor.getUTCDate());
      while (d <= after) d = addMonths(after, (months += n), anchor.getUTCDate());
      return d;
    }
    case 'YEARLY':
      return addMonths(after, 12 * n, anchor.getUTCDate());
  }
}

/**
 * Next due date after completing an occurrence due on `base`. Never returns a date before
 * `today` (completing a long-overdue recurring task doesn't spawn another overdue one).
 * Returns null when the series has ended.
 */
export function nextOccurrence(rule: RecurrenceRule, base: string, today: string): string | null {
  const anchor = toDate(base);
  const floor = toDate(today);
  let next = step(rule, anchor, anchor);
  for (let guard = 0; next < floor && guard < 1000; guard++) next = step(rule, next, anchor);
  if (rule.endDate && next > toDate(rule.endDate)) return null;
  return toIso(next);
}

/** Days between two ISO dates (b - a). */
export function daysBetween(a: string, b: string) {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

export function shiftDate(iso: string, days: number) {
  return toIso(addDays(toDate(iso), days));
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function describeRecurrence(r: RecurrenceRule) {
  const n = r.interval ?? 1;
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[r.freq];
  let s = n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
  if (r.freq === 'WEEKLY' && r.byWeekday?.length) s += ` on ${r.byWeekday.map((d) => WEEKDAYS[d]).join(', ')}`;
  if (r.endDate) s += ` until ${r.endDate}`;
  return s;
}
