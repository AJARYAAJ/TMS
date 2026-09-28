import type { TaskPriority, TaskStatus, TaskType } from '@/types';

export const STATUS_LABEL: Record<TaskStatus, string> = { TODO: 'To do', IN_PROGRESS: 'In progress', IN_REVIEW: 'In review', DONE: 'Done' };
export const PRIORITY_LABEL: Record<TaskPriority, string> = { URGENT: 'Urgent', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
export const TYPE_LABEL: Record<TaskType, string> = { TASK: 'Task', BUG: 'Bug', STORY: 'Story', EPIC: 'Epic' };

export function initials(name?: string | null) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
export function colorFor(id?: string | null) {
  if (!id) return '#94a3b8';
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function timeAgo(iso: string) {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return formatDate(iso);
}

/** Dates like "2026-09-30" are calendar dates — format them without timezone shifts. */
export function formatDate(value?: string | null, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  if (!value) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return d.toLocaleDateString(undefined, opts);
}

export const todayIso = () => toIsoDate(new Date());
export const toIsoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function isOverdue(due: string | null, status: TaskStatus) {
  return !!due && status !== 'DONE' && due < todayIso();
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
