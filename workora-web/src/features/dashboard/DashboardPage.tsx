import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Play, Square } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Avatar, EmptyState, formatMinutes, PriorityIcon, Ring, Skeleton, SkeletonRows, StatusBadge } from '@/components/ui';
import { useSession } from '@/features/auth/session.store';
import { GetStarted } from '@/features/explore/GetStarted';
import { useGoals } from '@/features/goals/api';
import { useProjects } from '@/features/projects/api';
import { useRunningTimer, useTimer } from '@/features/tasks/api';
import { TaskRow } from '@/features/tasks/TaskRow';
import { useOpenTask } from '@/features/tasks/useOpenTask';
import { api } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { Activity, Task } from '@/types';
import { formatDate, isOverdue, timeAgo, toIsoDate } from '@/utils/format';

interface Dashboard {
  openTasks: number;
  overdue: number;
  dueThisWeek: number;
  completedThisWeek: number;
  activeProjects: number;
  minutesThisWeek: number;
  heatmap: { date: string; count: number }[];
  upNext: Task[];
}

export default function DashboardPage() {
  const session = useSession()!;
  const { data, isLoading } = useQuery({ queryKey: qk.dashboard, queryFn: () => api.get<Dashboard>('/dashboard') });
  const activity = useQuery({ queryKey: qk.orgActivity, queryFn: () => api.get<Activity[]>('/activity', { limit: 12 }) });
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const focus = data?.upNext[0];

  return (
    <div className="page">
      <div className="bento dashboard">
        <section className="tile tile-hero span-2 row-2">
          <span className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          <h1 className="display">
            {greeting},<br />
            <span className="ink-volt">{session.user.name.split(' ')[0]}.</span>
          </h1>
          <p className="hero-sub">
            {isLoading ? (
              <Skeleton width={260} />
            ) : data?.openTasks ? (
              <>
                You have <strong>{data.openTasks}</strong> open {data.openTasks === 1 ? 'task' : 'tasks'}
                {data.overdue ? (
                  <>
                    , <strong className="text-danger">{data.overdue} overdue</strong>
                  </>
                ) : null}
                . Here's what's next.
              </>
            ) : (
              'Inbox zero. Nothing assigned to you right now.'
            )}
          </p>
          {focus && <FocusCard task={focus} />}
        </section>

        <GetStarted />

        <Stat label="Open" value={data?.openTasks} to="/my-work" loading={isLoading} />
        <Stat label="Overdue" value={data?.overdue} to="/my-work?filter=overdue" loading={isLoading} tone={data?.overdue ? 'danger' : undefined} />
        <Stat label="Due this week" value={data?.dueThisWeek} to="/my-work" loading={isLoading} />
        <Stat label="Tracked this week" value={data ? formatMinutes(data.minutesThisWeek) : undefined} to="/time" loading={isLoading} tone="volt" />

        <section className="tile span-2">
          <div className="tile-head">
            <h2>Momentum</h2>
            <span className="muted small">{data?.completedThisWeek ?? 0} done in the last 7 days</span>
          </div>
          {data ? <Heatmap data={data.heatmap} /> : <Skeleton height={96} />}
        </section>

        <ProjectRings />

        <section className="tile span-2 row-2">
          <div className="tile-head">
            <h2>Up next</h2>
            <Link to="/my-work" className="tile-link">
              My Work <ArrowUpRight size={14} />
            </Link>
          </div>
          {isLoading ? <SkeletonRows rows={5} /> : (data?.upNext.length ?? 0) > 1 ? data!.upNext.slice(1).map((t) => <TaskRow key={t.id} task={t} />) : <EmptyState title="Nothing else queued">Pick something from a backlog.</EmptyState>}
        </section>

        <GoalsTile />

        <section className="tile span-2">
          <div className="tile-head">
            <h2>Stream</h2>
            <span className="live-dot" aria-hidden />
          </div>
          {activity.isLoading ? (
            <SkeletonRows rows={4} />
          ) : (
            <ol className="stream">
              {activity.data?.map((a) => (
                <li key={a.id}>
                  <Avatar user={a.actor.id ? { id: a.actor.id, name: a.actor.name } : null} size={24} />
                  <span>
                    <strong>{a.actor.name}</strong> {a.summary}
                  </span>
                  <time className="muted small">{timeAgo(a.createdAt)}</time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function FocusCard({ task }: { task: Task }) {
  const openTask = useOpenTask();
  const { data: timer } = useRunningTimer();
  const { start, stop } = useTimer();
  const running = timer?.taskId === task.id;
  return (
    <div className="focus-card">
      <span className="eyebrow">Focus</span>
      <button className="focus-title" onClick={() => openTask(task.key)}>
        {task.title}
      </button>
      <div className="focus-meta">
        <span className="mono">{task.key}</span>
        <StatusBadge status={task.status} state={task.state} />
        <PriorityIcon priority={task.priority} withLabel />
        {task.dueDate && <span className={isOverdue(task.dueDate, task.status) ? 'text-danger' : ''}>Due {formatDate(task.dueDate)}</span>}
      </div>
      <div className="focus-actions">
        {running ? (
          <button className="btn btn-ink" onClick={() => stop.mutate()}>
            <Square size={13} fill="currentColor" /> Stop timer
          </button>
        ) : (
          <button className="btn btn-ink" onClick={() => start.mutate(task.key)} disabled={start.isPending}>
            <Play size={13} fill="currentColor" /> Start focus
          </button>
        )}
        <button className="btn btn-soft" onClick={() => openTask(task.key)}>
          Open
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, to, loading, tone }: { label: string; value: number | string | undefined; to: string; loading: boolean; tone?: 'danger' | 'volt' }) {
  return (
    <Link to={to} className={`tile tile-stat ${tone ? `tone-${tone}` : ''}`}>
      <span className="eyebrow">{label}</span>
      <span className="stat-number">{loading ? <Skeleton width={56} height={40} /> : value}</span>
      <ArrowUpRight size={16} className="tile-corner" />
    </Link>
  );
}

/** 12-week contribution heatmap of tasks completed per day (columns = weeks). */
function Heatmap({ data }: { data: { date: string; count: number }[] }) {
  const counts = new Map(data.map((d) => [d.date, d.count]));
  const today = new Date();
  const days = Array.from({ length: 84 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - 83 + i);
    return toIsoDate(d);
  });
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((n, d) => n + d.count, 0);
  const best = data.reduce((b, d) => (d.count > b.count ? d : b), { date: '', count: 0 });
  let streak = 0;
  for (let i = days.length - 1; i >= 0 && (counts.get(days[i]) ?? 0) > 0; i--) streak++;
  return (
    <div className="heatmap-wrap">
      <div className="heat-stats">
        <div>
          <strong>{total}</strong>
          <span className="muted small">done in 12 weeks</span>
        </div>
        <div>
          <strong>{streak}</strong>
          <span className="muted small">day streak</span>
        </div>
        <div>
          <strong>{best.count || '–'}</strong>
          <span className="muted small">{best.count ? `best · ${formatDate(best.date)}` : 'best day'}</span>
        </div>
      </div>
      <div className="heatmap" role="img" aria-label={`${total} tasks completed in the last 12 weeks`}>
        {days.map((d) => {
          const c = counts.get(d) ?? 0;
          const level = c === 0 ? 0 : Math.max(1, Math.ceil((c / max) * 4));
          return <span key={d} className={`heat l${level}`} title={`${formatDate(d)}: ${c} completed`} />;
        })}
      </div>
      <div className="heat-legend muted small">
        Less <span className="heat l0" /> <span className="heat l1" /> <span className="heat l2" /> <span className="heat l3" /> <span className="heat l4" /> More
      </div>
    </div>
  );
}

function ProjectRings() {
  const { data } = useProjects();
  const projects = (data ?? []).filter((p) => p.status === 'ACTIVE' && p.taskCount > 0).slice(0, 3);
  return (
    <section className="tile span-2">
      <div className="tile-head">
        <h2>Projects</h2>
        <Link to="/projects" className="tile-link">
          All <ArrowUpRight size={14} />
        </Link>
      </div>
      <div className="rings">
        {!data && <Skeleton height={80} />}
        {projects.map((p) => (
          <Link key={p.id} to={`/projects/${p.key}`} className="ring-card" style={{ ['--app' as any]: p.color }}>
            <Ring value={p.taskCount ? ((p.taskCount - p.openTaskCount) / p.taskCount) * 100 : 0} size={64} />
            <span className="ellipsis">{p.name}</span>
            <span className="muted small">{p.openTaskCount} open</span>
          </Link>
        ))}
        {data && !projects.length && <p className="muted small">No active projects yet.</p>}
      </div>
    </section>
  );
}

function GoalsTile() {
  const { data } = useGoals();
  return (
    <section className="tile span-2">
      <div className="tile-head">
        <h2>Goals</h2>
        <Link to="/goals" className="tile-link">
          All <ArrowUpRight size={14} />
        </Link>
      </div>
      {!data ? (
        <SkeletonRows rows={2} />
      ) : data.length ? (
        <ul className="goal-mini">
          {data.slice(0, 3).map((g) => (
            <li key={g.id}>
              <span className={`goal-status gs-${g.status.toLowerCase()}`} title={g.status.replace('_', ' ')} />
              <span className="ellipsis">{g.title}</span>
              <span className="bar">
                <span style={{ width: `${g.progress}%` }} />
              </span>
              <strong>{g.progress}%</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">
          No goals yet. <Link to="/goals">Set one</Link>.
        </p>
      )}
    </section>
  );
}
