import type { Recurrence } from '@/types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeRecurrence(r: Recurrence | null | undefined) {
  if (!r) return 'Does not repeat';
  const n = r.interval ?? 1;
  if (r.freq === 'WEEKLY' && n === 1 && r.byWeekday?.length === 5 && [1, 2, 3, 4, 5].every((d) => r.byWeekday!.includes(d))) return 'Every weekday';
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[r.freq];
  let s = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
  if (r.freq === 'WEEKLY' && r.byWeekday?.length) s += ` on ${r.byWeekday.map((d) => WEEKDAYS[d]).join(', ')}`;
  if (r.endDate) s += ` until ${r.endDate}`;
  return s;
}

/** Common presets, anchored on the task's due date (or today). */
export function recurrencePresets(anchor: string | null): { id: string; label: string; rule: Recurrence | null }[] {
  const d = anchor ? new Date(`${anchor}T00:00:00`) : new Date();
  const wd = d.getDay();
  const dom = d.getDate();
  return [
    { id: 'none', label: 'Does not repeat', rule: null },
    { id: 'daily', label: 'Every day', rule: { freq: 'DAILY' } },
    { id: 'weekdays', label: 'Every weekday (Mon–Fri)', rule: { freq: 'WEEKLY', byWeekday: [1, 2, 3, 4, 5] } },
    { id: 'weekly', label: `Every week on ${WEEKDAYS[wd]}`, rule: { freq: 'WEEKLY', byWeekday: [wd] } },
    { id: 'biweekly', label: `Every 2 weeks on ${WEEKDAYS[wd]}`, rule: { freq: 'WEEKLY', interval: 2, byWeekday: [wd] } },
    { id: 'monthly', label: `Every month on day ${dom}`, rule: { freq: 'MONTHLY' } },
    { id: 'quarterly', label: `Every 3 months on day ${dom}`, rule: { freq: 'MONTHLY', interval: 3 } },
    { id: 'yearly', label: 'Every year', rule: { freq: 'YEARLY' } },
  ];
}
