import { BarChart3, CalendarDays, FileText, GanttChart, Kanban, LayoutGrid, List, ListTodo, Map, Plus, Rocket, Star, Target, Workflow, Zap } from 'lucide-react';
import { Suspense } from 'react';
import { NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { PageSkeleton } from '@/app/layouts/AppShell';
import { useUiStore } from '@/app/ui.store';
import { EmptyState, Ring, Skeleton } from '@/components/ui';
import { useCan } from '@/features/auth/session.store';
import { ApiError } from '@/services/api/client';
import { useWatchProject } from '@/services/websocket/useRealtime';
import type { Project } from '@/types';
import { useProject, useToggleFavorite } from './api';

const VIEWS = [
  ['', 'Overview', LayoutGrid],
  ['list', 'List', List],
  ['board', 'Board', Kanban],
  ['backlog', 'Backlog', ListTodo],
  ['sprint', 'Sprint', Rocket],
  ['calendar', 'Calendar', CalendarDays],
  ['timeline', 'Timeline', GanttChart],
  ['roadmap', 'Roadmap', Map],
  ['goals', 'Goals', Target],
  ['docs', 'Docs', FileText],
  ['reports', 'Reports', BarChart3],
  ['automations', 'Automations', Zap],
  ['workflow', 'Workflow', Workflow],
] as const;

/** Project workspace: hero header + view switcher. Switching views is client-side routing only. */
export default function ProjectLayout() {
  const { projectKey } = useParams();
  const { data: project, error, isLoading } = useProject(projectKey);
  const canCreate = useCan('MEMBER');
  const openCreateTask = useUiStore((s) => s.openCreateTask);
  const favorite = useToggleFavorite();
  useWatchProject(project?.id);

  if (error && !project) {
    return (
      <div className="page">
        <EmptyState title={error instanceof ApiError && error.status === 404 ? 'Project not found' : "Couldn't load project"}>{(error as Error).message}</EmptyState>
      </div>
    );
  }
  const done = project ? project.taskCount - project.openTaskCount : 0;

  return (
    <div className="project-workspace">
      <header className="project-hero" style={{ ['--app' as any]: project?.color ?? 'var(--ink-3)' }}>
        <div className="project-hero-main">
          {project ? (
            <>
              <span className="project-mark">{project.key.slice(0, 2)}</span>
              <div className="project-hero-text">
                <span className="eyebrow">
                  {project.key} · {project.openTaskCount} open · {done} done
                </span>
                <h1 className="display-sm">{project.name}</h1>
              </div>
              <button
                className={`star${project.isFavorite ? ' on' : ''}`}
                onClick={() => favorite.mutate({ id: project.id, on: !project.isFavorite })}
                aria-label={project.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                aria-pressed={project.isFavorite}
                title={project.isFavorite ? 'Pinned to your dock' : 'Pin to your dock'}
              >
                <Star size={18} fill={project.isFavorite ? 'currentColor' : 'none'} />
              </button>
              <span className="ml-auto project-hero-ring">
                <Ring value={project.taskCount ? (done / project.taskCount) * 100 : 0} size={54} />
              </span>
              {canCreate && (
                <button className="btn btn-ink" onClick={() => openCreateTask({ projectId: project.id })}>
                  <Plus size={15} /> Task
                </button>
              )}
            </>
          ) : (
            <Skeleton width={320} height={40} />
          )}
        </div>
        <nav className="view-switch" aria-label="Project views">
          {VIEWS.map(([path, label, Icon]) => (
            <NavLink key={path} to={path ? `/projects/${projectKey}/${path}` : `/projects/${projectKey}`} end className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon size={14} /> <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </header>
      <div className="project-content">
        {isLoading && !project ? (
          <PageSkeleton />
        ) : (
          <Suspense fallback={<PageSkeleton />}>
            <Outlet context={project} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

export const useProjectContext = () => useOutletContext<Project>();
