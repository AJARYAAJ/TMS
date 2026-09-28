import { Bell, CheckCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Avatar, Skeleton } from '@/components/ui';
import { useOpenTask } from '@/features/tasks/useOpenTask';
import { timeAgo } from '@/utils/format';
import { useMarkRead, useNotifications } from './api';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useNotifications();
  const markRead = useMarkRead();
  const openTask = useOpenTask();
  const unread = data?.meta.unreadCount ?? 0;

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="menu-anchor" ref={ref}>
      <button className="icon-btn bell" onClick={() => setOpen(!open)} aria-label={`Notifications (${unread} unread)`} aria-expanded={open}>
        <Bell size={18} />
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="menu notifications-menu" role="menu">
          <div className="menu-title">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={() => markRead.mutate('all')}>
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>
          <div className="notifications-list">
            {isLoading &&
              Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="notification">
                  <Skeleton height={36} />
                </div>
              ))}
            {data?.data.length === 0 && <p className="muted small" style={{ padding: 16 }}>You're all caught up.</p>}
            {data?.data.map((n) => (
              <button
                key={n.id}
                className={`notification${n.read ? '' : ' unread'}`}
                onClick={() => {
                  if (!n.read) markRead.mutate(n.id);
                  if (n.taskKey) openTask(n.taskKey);
                  setOpen(false);
                }}
              >
                <Avatar user={n.actor ? { id: n.actor.id, name: n.actor.name } : null} size={28} />
                <span className="notification-text">
                  <span>{n.title}</span>
                  {n.body && <span className="muted small ellipsis">{n.body}</span>}
                  <span className="muted small">{timeAgo(n.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
