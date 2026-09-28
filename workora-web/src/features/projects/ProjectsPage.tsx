import { FolderKanban, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useUiStore } from '@/app/ui.store';
import { Avatar, EmptyState, ProgressBar, Skeleton } from '@/components/ui';
import { useCan } from '@/features/auth/session.store';
import { useProjects } from './api';

export default function ProjectsPage() {
  const { data, isLoading } = useProjects();
  const canCreate = useCan('MEMBER');
  const setCreateProject = useUiStore((s) => s.setCreateProject);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Projects</h1>
          <p className="muted">All projects in this workspace</p>
        </div>
        {canCreate && (
          <button className="btn btn-primary" onClick={() => setCreateProject(true)}>
            <Plus size={16} /> New project
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="project-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="card project-card">
              <Skeleton width="60%" height={18} />
              <Skeleton width="90%" style={{ marginTop: 12 }} />
              <Skeleton width="40%" style={{ marginTop: 20 }} />
            </div>
          ))}
        </div>
      ) : !data?.length ? (
        <EmptyState icon={<FolderKanban size={32} />} title="No projects yet" action={canCreate && <button className="btn btn-primary" onClick={() => setCreateProject(true)}>Create your first project</button>}>
          Projects hold your tasks, boards, sprints and reports.
        </EmptyState>
      ) : (
        <div className="project-grid">
          {data.map((p) => (
            <Link key={p.id} to={`/projects/${p.key}`} className={`card project-card${p.status === 'ARCHIVED' ? ' archived' : ''}`}>
              <div className="project-card-header">
                <span className="project-badge" style={{ background: p.color }}>
                  {p.key.slice(0, 2)}
                </span>
                <div>
                  <strong>{p.name}</strong>
                  <div className="muted small">
                    {p.key}
                    {p.status === 'ARCHIVED' && ' · archived'}
                  </div>
                </div>
              </div>
              <p className="muted small clamp-2">{p.description || 'No description'}</p>
              <ProgressBar value={p.taskCount - p.openTaskCount} max={p.taskCount} />
              <div className="project-card-footer">
                <span className="small muted">
                  {p.taskCount - p.openTaskCount}/{p.taskCount} done
                </span>
                <Avatar user={p.owner} size={22} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
