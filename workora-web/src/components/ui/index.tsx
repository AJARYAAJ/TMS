import { ArrowDown, ArrowUp, Bookmark, Bug, CheckSquare, ChevronsUp, Layers, Minus, X } from 'lucide-react';
import { ReactNode, useEffect, useRef } from 'react';
import type { TaskPriority, TaskStatus, TaskType, UserSummary } from '@/types';
import { colorFor, initials, PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL } from '@/utils/format';

export function Avatar({ user, size = 24 }: { user: Pick<UserSummary, 'id' | 'name'> | null | undefined; size?: number }) {
  return (
    <span
      className="avatar"
      title={user?.name ?? 'Unassigned'}
      style={{ width: size, height: size, fontSize: size * 0.42, background: user ? colorFor(user.id) : 'var(--surface-3)', color: user ? '#fff' : 'var(--text-3)' }}
    >
      {user ? initials(user.name) : '–'}
    </span>
  );
}

/** Shows the workflow state (custom name & colour) when known, else the status category. */
export function StatusBadge({ status, state }: { status: TaskStatus; state?: { name: string; color: string } | null }) {
  return (
    <span className={`badge status-${status.toLowerCase()}`} style={state ? ({ ['--st' as any]: state.color } as React.CSSProperties) : undefined}>
      {state?.name ?? STATUS_LABEL[status]}
    </span>
  );
}

const PRIORITY_ICON = { URGENT: ChevronsUp, HIGH: ArrowUp, MEDIUM: Minus, LOW: ArrowDown };
export function PriorityIcon({ priority, withLabel }: { priority: TaskPriority; withLabel?: boolean }) {
  const Icon = PRIORITY_ICON[priority];
  return (
    <span className={`priority priority-${priority.toLowerCase()}`} title={`${PRIORITY_LABEL[priority]} priority`}>
      <Icon size={14} strokeWidth={2.5} />
      {withLabel && PRIORITY_LABEL[priority]}
    </span>
  );
}

const TYPE_ICON = { TASK: CheckSquare, BUG: Bug, STORY: Bookmark, EPIC: Layers };
export function TypeIcon({ type }: { type: TaskType }) {
  const Icon = TYPE_ICON[type];
  return (
    <span className={`type-icon type-${type.toLowerCase()}`} title={TYPE_LABEL[type]}>
      <Icon size={14} />
    </span>
  );
}

export function Skeleton({ width = '100%', height = 14, radius = 6, style }: { width?: number | string; height?: number | string; radius?: number; style?: React.CSSProperties }) {
  return <span className="skeleton" style={{ width, height, borderRadius: radius, ...style }} aria-hidden />;
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skeleton-rows" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row">
          <Skeleton width={64} />
          <Skeleton width={`${45 + ((i * 17) % 40)}%`} />
          <Skeleton width={24} height={24} radius={12} style={{ marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Dialog({ open, onClose, title, children, width = 520 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} style={{ width }} ref={ref}>
        <header className="dialog-header">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />;
}

/** Inline, component-local save indicator ("Saving…" next to the field — never a full-screen loader). */
export function SavingIndicator({ saving, error }: { saving: boolean; error?: string | null }) {
  if (error) return <span className="saving saving-error">{error}</span>;
  if (!saving) return null;
  return (
    <span className="saving">
      <Spinner size={10} /> Saving…
    </span>
  );
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Circular progress ring (SVG). */
export function Ring({ value, size = 56, stroke = 6, label }: { value: number; size?: number; stroke?: number; label?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <span className="ring" style={{ width: size, height: size }} role="img" aria-label={`${Math.round(pct)}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle className="ring-fill" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="ring-label">{label ?? `${Math.round(pct)}%`}</span>
    </span>
  );
}

export function LabelChip({ label, onRemove }: { label: { name: string; color: string }; onRemove?: () => void }) {
  return (
    <span className="label-chip" style={{ ['--lc' as any]: label.color }}>
      {label.name}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${label.name}`}>
          <X size={10} />
        </button>
      )}
    </span>
  );
}

export function AvatarStack({ users, max = 4, size = 22 }: { users: Pick<UserSummary, 'id' | 'name'>[]; max?: number; size?: number }) {
  return (
    <span className="avatar-stack">
      {users.slice(0, max).map((u) => (
        <Avatar key={u.id} user={u} size={size} />
      ))}
      {users.length > max && <span className="avatar more" style={{ width: size, height: size, fontSize: size * 0.4 }}>+{users.length - max}</span>}
    </span>
  );
}

export const formatMinutes = (m: number | null | undefined) => {
  if (!m) return '0m';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}h${r ? ` ${r}m` : ''}` : `${r}m`;
};
