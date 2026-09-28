import { Plus } from 'lucide-react';
import { Suspense } from 'react';
import { NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { PageSkeleton } from '@/app/layouts/AppShell';
import { useUiStore } from '@/app/ui.store';
import { EmptyState, Skeleton } from '@/components/ui';
import { useCan } from '@/features/auth/session.store';
import { ApiError } from '@/services/api/client';
import { useWatchProject } from '@/services/websocket/useRealtime';
import type { Project } from '@/types';
import { useProject } from './api';

const VIEWS = [
  ['', 'Overview'],
  ['list', 'List'],
  ['board', 'Board'],
  ['calendar', 'Calendar'],
  ['timeline', 'Timeline'],
  ['backlog', 'Backlog'],
  ['sprint', 'Sprint'],
  ['goals', 'Goals'],
  ['documents', 'Documents'],
  ['reports', 'Reports'],
] as const;

/** Project workspace: header + view tabs. Switching views is client-side routing only. */
export default function ProjectLayout() {
  const { projectKey } = useParams();
  const { data: project, error, isLoading } = useProject(projectKey);
  const canCreate = useCan('MEMBER');
  const openCreateTask = useUiStore((s) => s.openCreateTask);
  useWatchProject(project?.id);

  if (error && !project) {
    return (
      <div className="page">
        <EmptyState title={error instanceof ApiError && error.status === 404 ? 'Project not found' : "Couldn't load project"}>{(error as Error).message}</EmptyState>
      </div>
    );
  }

  return (
    <div className="project-workspace">
      <div className="project-header">
        <div className="project-title">
          {project ? (
            <>
              <span className="project-badge" style={{ background: project.color }}>
                {project.key.slice(0, 2)}
              </span>
              <h1>{project.name}</h1>
              <span className="muted small">{project.key}</span>
            </>
          ) : (
            <Skeleton width={260} height={28} />
          )}
          {canCreate && project && (
            <button className="btn btn-ghost btn-sm ml-auto" onClick={() => openCreateTask({ projectId: project.id })}>
              <Plus size={14} /> Add task
            </button>
          )}
        </div>
        <nav className="view-tabs">
          {VIEWS.map(([path, label]) => (
            <NavLink key={path} to={path ? `/projects/${projectKey}/${path}` : `/projects/${projectKey}`} end className={({ isActive }) => (isActive ? 'active' : '')}>
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
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
