import { CheckCheck, Inbox } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, SkeletonRows } from '@/components/ui';
import { useMarkRead, useNotifications, useOpenNotification } from '@/features/notifications/api';
import { NotificationAvatar } from '@/features/notifications/NotificationIcon';
import { timeAgo } from '@/utils/format';

const GROUPS: [string, (d: Date) => boolean][] = [
  ['Today', (d) => d.toDateString() === new Date().toDateString()],
  ['This week', (d) => Date.now() - d.getTime() < 7 * 86400000],
  ['Earlier', () => true],
];

/** Full-page notification inbox, grouped by recency with unread filtering. */
export default function InboxPage() {
  const { data, isLoading } = useNotifications();
  const markRead = useMarkRead();
  const open = useOpenNotification();
  const [filter, setFilter] = useState<'all' | 'unread' | 'mentions'>('all');
  const unreadOnly = filter === 'unread';
  const items = (data?.data ?? []).filter((n) => (filter === 'unread' ? !n.read : filter === 'mentions' ? n.category === 'mentioned' : true));
  const used = new Set<string>();
  const grouped = GROUPS.map(([label, test]) => {
    const list = items.filter((n) => !used.has(n.id) && test(new Date(n.createdAt)));
    list.forEach((n) => used.add(n.id));
    return [label, list] as const;
  }).filter(([, l]) => l.length);

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <div>
          <span className="eyebrow">{data?.meta.unreadCount ?? 0} unread</span>
          <h1 className="display-sm">Inbox</h1>
        </div>
        <div className="toolbar">
          <div className="seg">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
              All
            </button>
            <button className={unreadOnly ? 'active' : ''} onClick={() => setFilter('unread')}>
              Unread
            </button>
            <button className={filter === 'mentions' ? 'active' : ''} onClick={() => setFilter('mentions')}>
              @Mentions
            </button>
          </div>
          <button className="btn btn-soft btn-sm" onClick={() => markRead.mutate('all')} disabled={!data?.meta.unreadCount}>
            <CheckCheck size={14} /> Mark all read
          </button>
        </div>
      </header>
      {isLoading ? (
        <SkeletonRows rows={6} />
      ) : !items.length ? (
        <EmptyState icon={<Inbox size={32} />} title={unreadOnly ? 'All caught up' : 'Nothing here yet'}>
          Assignments, mentions, comments, status changes, due dates, GitHub activity, form responses and more land here.
        </EmptyState>
      ) : (
        grouped.map(([label, list]) => (
          <section key={label} className="inbox-group">
            <h2 className="eyebrow">{label}</h2>
            <div className="tile inbox-list">
              {list.map((n) => (
                <button
                  key={n.id}
                  className={`inbox-item${n.read ? '' : ' unread'}`}
                  onClick={() => open(n)}
                >
                  <NotificationAvatar n={n} size={32} />
                  <span className="inbox-text">
                    <strong>{n.title}</strong>
                    {n.body && <span className="muted ellipsis">{n.body}</span>}
                  </span>
                  <span className="inbox-side">
                    {n.taskKey && <span className="mono small">{n.taskKey}</span>}
                    <time className="muted small">{timeAgo(n.createdAt)}</time>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
