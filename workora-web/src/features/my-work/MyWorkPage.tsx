import { useSearchParams } from 'react-router-dom';
import { EmptyState, SkeletonRows } from '@/components/ui';
import { useUsers } from '@/features/projects/api';
import { useTasks } from '@/features/tasks/api';
import { TaskRow } from '@/features/tasks/TaskRow';
import { useSession } from '@/features/auth/session.store';
import { todayIso, toIsoDate } from '@/utils/format';

const FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'done', label: 'Completed' },
  { id: 'all', label: 'All' },
] as const;

export default function MyWorkPage() {
  const [params, setParams] = useSearchParams();
  const filter = (params.get('filter') ?? 'open') as (typeof FILTERS)[number]['id'];
  const assignee = params.get('assignee') ?? 'me';
  const me = useSession()!.user.id;
  const { data: users } = useUsers();
  const person = assignee === 'me' || assignee === me ? null : users?.find((u) => u.id === assignee);

  const { data, isLoading, isFetching } = useTasks({
    assigneeId: assignee,
    open: filter === 'open' || filter === 'overdue' ? 'true' : filter === 'done' ? 'false' : undefined,
    dueTo: filter === 'overdue' ? offsetDay(-1) : undefined,
    sort: filter === 'done' ? 'updatedAt' : 'dueDate',
    order: filter === 'done' ? 'desc' : 'asc',
    size: 200,
  });

  const setFilter = (f: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set('filter', f);
      return n;
    });

  const groups = groupByDue(data?.data ?? [], filter);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{person ? `${person.name}'s work` : 'My Work'}</h1>
          <p className="muted">{person ? 'Tasks assigned to this person across all projects' : 'Everything assigned to you, across all projects'}</p>
        </div>
      </div>
      <div className="toolbar">
        <div className="segmented">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        {isFetching && !isLoading && <span className="muted small">Updating…</span>}
      </div>
      <div className="card">
        {isLoading ? (
          <SkeletonRows rows={8} />
        ) : !data?.data.length ? (
          <EmptyState title="No tasks here">Tasks assigned to {person ? person.name : 'you'} will show up here.</EmptyState>
        ) : (
          groups.map(([label, tasks]) => (
            <div key={label} className="task-group">
              <div className="task-group-header">
                {label} <span className="count">{tasks.length}</span>
              </div>
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function offsetDay(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toIsoDate(d);
}

function groupByDue<T extends { dueDate: string | null; status: string }>(tasks: T[], filter: string): [string, T[]][] {
  if (filter === 'done' || filter === 'overdue') return [[filter === 'done' ? 'Completed' : 'Overdue', tasks]];
  const today = todayIso();
  const week = offsetDay(7);
  const buckets: Record<string, T[]> = { Overdue: [], Today: [], 'This week': [], Later: [], 'No due date': [], Done: [] };
  for (const t of tasks) {
    if (t.status === 'DONE') buckets.Done.push(t);
    else if (!t.dueDate) buckets['No due date'].push(t);
    else if (t.dueDate < today) buckets.Overdue.push(t);
    else if (t.dueDate === today) buckets.Today.push(t);
    else if (t.dueDate <= week) buckets['This week'].push(t);
    else buckets.Later.push(t);
  }
  return Object.entries(buckets).filter(([, v]) => v.length > 0);
}
