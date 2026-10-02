import { Bell, BellRing, CheckCheck, Settings, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui';
import { toast } from '@/components/ui/toast';
import type { Notification } from '@/types';
import { timeAgo } from '@/utils/format';
import { useMarkRead, useNotifications, useOpenNotification } from './api';
import { enableDesktop, useDesktop } from './desktop';
import { NotificationAvatar } from './NotificationIcon';

type Filter = 'all' | 'unread' | 'mentions';
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['mentions', '@Mentions'],
];
const matches = (f: Filter) => (n: Notification) => (f === 'unread' ? !n.read : f === 'mentions' ? n.category === 'mentioned' : true);
const DISMISSED = 'workora.desktopPromptDismissed';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const ref = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useNotifications();
  const markRead = useMarkRead();
  const openNotification = useOpenNotification();
  const unread = data?.meta.unreadCount ?? 0;
  const items = (data?.data ?? []).filter(matches(filter));

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="menu-anchor" ref={ref}>
      <button className={`icon-btn bell${unread ? ' has-unread' : ''}`} onClick={() => setOpen(!open)} aria-label={`Notifications (${unread} unread)`} aria-expanded={open} aria-haspopup="dialog">
        <Bell size={18} />
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="menu notifications-menu" role="dialog" aria-label="Notifications">
          <div className="menu-title">
            <strong>Notifications</strong>
            <span className="row-tools ml-auto">
              {unread > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={() => markRead.mutate('all')}>
                  <CheckCheck size={14} /> Mark all read
                </button>
              )}
              <Link to="/settings" className="icon-btn" aria-label="Notification settings" title="Notification settings" onClick={() => setOpen(false)}>
                <Settings size={15} />
              </Link>
            </span>
          </div>
          <div className="seg seg-sm note-filters" role="tablist" aria-label="Filter notifications">
            {FILTERS.map(([f, label]) => (
              <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                {label}
                {f === 'unread' && unread > 0 && <span className="seg-count">{unread}</span>}
              </button>
            ))}
          </div>
          <DesktopPrompt />
          <div className="notifications-list">
            {isLoading &&
              Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="notification">
                  <Skeleton height={36} />
                </div>
              ))}
            {data && !items.length && (
              <p className="muted small note-empty">{filter === 'all' ? 'Nothing yet. Assignments, mentions and updates on your work show up here.' : filter === 'unread' ? "You're all caught up." : 'No mentions yet.'}</p>
            )}
            {items.map((n) => (
              <button
                key={n.id}
                className={`notification${n.read ? '' : ' unread'}`}
                onClick={() => {
                  openNotification(n);
                  setOpen(false);
                }}
              >
                <NotificationAvatar n={n} />
                <span className="notification-text">
                  <span>{n.title}</span>
                  {n.body && <span className="muted small ellipsis">{n.body}</span>}
                  <span className="muted small">{timeAgo(n.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
          <Link to="/inbox" className="menu-foot" onClick={() => setOpen(false)}>
            Open Inbox
          </Link>
        </div>
      )}
    </div>
  );
}

/** A one-time invitation to turn on desktop notifications, right where people look for them. */
function DesktopPrompt() {
  const { mode, busy } = useDesktop();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED) === '1';
    } catch {
      return false;
    }
  });
  if (mode !== 'off' || dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {
      /* private mode: it just shows again next time */
    }
  };
  return (
    <div className="desktop-prompt">
      <BellRing size={16} />
      <span className="small">Get desktop notifications when Workora is in the background.</span>
      <button
        className="btn btn-volt btn-sm"
        disabled={busy}
        onClick={async () => {
          const m = await enableDesktop();
          if (m === 'push' || m === 'tab') toast.success('Desktop notifications are on');
          else if (m === 'blocked') toast.error('Notifications are blocked for this site in your browser settings');
        }}
      >
        Turn on
      </button>
      <button className="icon-btn" aria-label="Dismiss" onClick={dismiss}>
        <X size={14} />
      </button>
    </div>
  );
}
