import { FolderKanban, MessageSquare, Search, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Spinner, StatusBadge } from '@/components/ui';
import { useOpenTask } from '@/features/tasks/useOpenTask';
import { useHotkey } from '@/hooks/useHotkey';
import { useSearch } from './api';

type Hit = { kind: 'task' | 'project' | 'user' | 'comment'; id: string; go: () => void };

export function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const { data, isFetching, pending } = useSearch(q);
  const openTask = useOpenTask();
  const navigate = useNavigate();

  useHotkey('/', () => input.current?.focus());
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const done = () => {
    setOpen(false);
    setQ('');
    input.current?.blur();
  };
  const hits: Hit[] =
    q.trim().length >= 2 && data
      ? [
          ...data.tasks.map((t) => ({ kind: 'task' as const, id: t.id, go: () => openTask(t.key) })),
          ...data.projects.map((p) => ({ kind: 'project' as const, id: p.id, go: () => navigate(`/projects/${p.key}`) })),
          ...data.users.map((u) => ({ kind: 'user' as const, id: u.id, go: () => navigate(`/my-work?assignee=${u.id}`) })),
          ...data.comments.map((c) => ({ kind: 'comment' as const, id: c.id, go: () => openTask(c.taskKey) })),
        ]
      : [];
  useEffect(() => setActive(0), [data]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && hits[active]) {
      hits[active].go();
      done();
    } else if (e.key === 'Escape') {
      done();
    }
  };

  const idx = (kind: Hit['kind'], id: string) => hits.findIndex((h) => h.kind === kind && h.id === id);
  const itemProps = (kind: Hit['kind'], id: string) => {
    const i = idx(kind, id);
    return {
      className: `search-item${i === active ? ' active' : ''}`,
      onMouseEnter: () => setActive(i),
      onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
      onClick: () => {
        hits[i].go();
        done();
      },
    };
  };

  return (
    <div className="global-search" ref={ref}>
      <Search size={16} className="search-icon" />
      <input
        ref={input}
        value={q}
        placeholder="Search Workora…"
        aria-label="Search Workora"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {(isFetching || pending) && q.trim().length >= 2 && <Spinner size={12} />}
      {open && q.trim().length >= 2 && data && (
        <div className="search-results" role="listbox">
          {hits.length === 0 && !pending && <p className="muted small search-empty">No results for “{q}”</p>}
          {data.tasks.length > 0 && <div className="search-group">Tasks</div>}
          {data.tasks.map((t) => (
            <button key={t.id} {...itemProps('task', t.id)}>
              <span className="task-key">{t.key}</span>
              <span className="ellipsis">{t.title}</span>
              <StatusBadge status={t.status} />
            </button>
          ))}
          {data.projects.length > 0 && <div className="search-group">Projects</div>}
          {data.projects.map((p) => (
            <button key={p.id} {...itemProps('project', p.id)}>
              <FolderKanban size={14} style={{ color: p.color }} />
              <span>{p.name}</span>
              <span className="muted small">{p.key}</span>
            </button>
          ))}
          {data.users.length > 0 && <div className="search-group">People</div>}
          {data.users.map((u) => (
            <button key={u.id} {...itemProps('user', u.id)}>
              <Avatar user={u} size={18} />
              <span>{u.name}</span>
              <span className="muted small">{u.email}</span>
              <User size={12} className="ml-auto muted" />
            </button>
          ))}
          {data.comments.length > 0 && <div className="search-group">Comments</div>}
          {data.comments.map((c) => (
            <button key={c.id} {...itemProps('comment', c.id)}>
              <MessageSquare size={14} />
              <span className="task-key">{c.taskKey}</span>
              <span className="ellipsis muted">{c.snippet}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
