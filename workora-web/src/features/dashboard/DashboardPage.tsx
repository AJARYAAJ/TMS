import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CheckCircle2, FolderKanban, ListTodo } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, Skeleton, SkeletonRows } from '@/components/ui';
import { useSession } from '@/features/auth/session.store';
import { useProjects } from '@/features/projects/api';
import { TaskRow } from '@/features/tasks/TaskRow';
import { api } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { Activity, Task } from '@/types';
import { timeAgo } from '@/utils/format';

interface Dashboard {
  openTasks: number;
  overdue: number;
  dueThisWeek: number;
  completedThisWeek: number;
  activeProjects: number;
  upNext: Task[];
}

export default function DashboardPage() {
  const session = useSession()!;
  const { data, isLoading } = useQuery({ queryKey: qk.dashboard, queryFn: () => api.get<Dashboard>('/dashboard') });
  const activity = useQuery({ queryKey: qk.orgActivity, queryFn: () => api.get<Activity[]>('/activity', { limit: 15 }) });
  const { data: projects } = useProjects();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const stats = [
    { label: 'Open tasks', value: data?.openTasks, icon: <ListTodo size={18} />, to: '/my-work' },
    { label: 'Overdue', value: data?.overdue, icon: <AlertTriangle size={18} />, to: '/my-work?filter=overdue', tone: data?.overdue ? 'danger' : '' },
    { label: 'Due this week', value: data?.dueThisWeek, icon: <CalendarClock size={18} />, to: '/my-work' },
    { label: 'Completed (7d)', value: data?.completedThisWeek, icon: <CheckCircle2 size={18} />, to: '/my-work?filter=done' },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>
            {greeting}, {session.user.name.split(' ')[0]}
          </h1>
          <p className="muted">{session.organization.name}</p>
        </div>
      </div>

      <div className="stat-grid">
        {stats.map((s) => (
          <Link key={s.label} to={s.to} className={`stat-card ${s.tone ?? ''}`}>
            <span className="stat-icon">{s.icon}</span>
            <span className="stat-label">{s.label}</span>
            <span className="stat-value">{isLoading ? <Skeleton width={40} height={26} /> : s.value}</span>
          </Link>
        ))}
      </div>

      <div className="dashboard-grid">
        <section className="card">
          <div className="card-header">
            <h2>Up next</h2>
            <Link to="/my-work" className="small">
              View all
            </Link>
          </div>
          {isLoading ? <SkeletonRows rows={5} /> : data?.upNext.length ? data.upNext.map((t) => <TaskRow key={t.id} task={t} />) : <EmptyState title="Nothing assigned to you">Enjoy the calm — or pick something from a backlog.</EmptyState>}
        </section>

        <section className="card">
          <div className="card-header">
            <h2>Projects</h2>
            <Link to="/projects" className="small">
              All projects
            </Link>
          </div>
          {!projects ? (
            <SkeletonRows rows={3} />
          ) : (
            <ul className="project-list">
              {projects
                .filter((p) => p.status === 'ACTIVE')
                .slice(0, 6)
                .map((p) => (
                  <li key={p.id}>
                    <Link to={`/projects/${p.key}`}>
                      <FolderKanban size={16} style={{ color: p.color }} />
                      <span>{p.name}</span>
                      <span className="muted small ml-auto">{p.openTaskCount} open</span>
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </section>

        <section className="card span-2">
          <div className="card-header">
            <h2>Recent activity</h2>
          </div>
          {activity.isLoading ? (
            <SkeletonRows rows={4} />
          ) : (
            <ul className="activity">
              {activity.data?.map((a) => (
                <li key={a.id}>
                  <strong>{a.actor.name}</strong> {a.summary}
                  <span className="muted small"> · {timeAgo(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
