import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, LabelChip, SkeletonRows } from '@/components/ui';
import { useProjects } from '@/features/projects/api';
import { useLabels, useTasks } from '@/features/tasks/api';
import { TaskRow } from '@/features/tasks/TaskRow';

/** Every task with one label, across all projects (Admin → Labels links here). */
export default function LabelPage() {
  const { labelId } = useParams();
  const { data: labels } = useLabels();
  const { data: projects } = useProjects();
  const [showDone, setShowDone] = useState(false);
  const label = labels?.find((l) => l.id === labelId);
  const { data, isLoading } = useTasks({ labelId, open: showDone ? undefined : 'true', sort: 'updatedAt', order: 'desc', size: 200 }, !!labelId);
  const tasks = data?.data ?? [];
  const groups = (projects ?? []).map((p) => ({ project: p, tasks: tasks.filter((t) => t.projectId === p.id) })).filter((g) => g.tasks.length);

  return (
    <div className="page label-page">
      <header className="page-head">
        <div>
          <Link to="/admin" className="muted small back-link">
            <ArrowLeft size={13} /> Labels
          </Link>
          <h1 className="display-sm label-title" style={{ ['--lc' as any]: label?.color }}>
            {label ? <LabelChip label={label} /> : '…'}
          </h1>
          {label?.description && <p className="muted">{label.description}</p>}
        </div>
        <label className="check">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Include done
        </label>
      </header>
      {isLoading ? (
        <SkeletonRows rows={6} />
      ) : groups.length ? (
        groups.map((g) => (
          <section key={g.project.id} className="tile list-tile">
            <div className="tile-head">
              <h2>
                <Link to={`/projects/${g.project.key}/list`}>{g.project.name}</Link>
              </h2>
              <span className="muted small">{g.tasks.length}</span>
            </div>
            {g.tasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </section>
        ))
      ) : (
        <EmptyState title={showDone ? 'No tasks with this label' : 'No open tasks with this label'}>Add it from a task's label picker or with bulk edit in a List.</EmptyState>
      )}
    </div>
  );
}
