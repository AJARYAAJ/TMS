import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, SkeletonRows, TypeIcon } from '@/components/ui';
import { toast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/session.store';
import { useProjects } from '@/features/projects/api';
import { useOpenTask } from '@/features/tasks/useOpenTask';
import { api, errorMessage } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { Task, TrashedTask } from '@/types';
import { timeAgo } from '@/utils/format';

const daysLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));

/** Trash: deleted tasks stay here for 30 days. Restore brings back subtasks, comments, time and files. */
export default function TrashPage() {
  const qc = useQueryClient();
  const { data: projects } = useProjects();
  const [projectId, setProjectId] = useState('');
  const canRestore = useCan('MEMBER');
  const canPurge = useCan('ADMIN');
  const openTask = useOpenTask();
  const { data, isLoading } = useQuery({ queryKey: [...qk.trash, projectId], queryFn: () => api.get<TrashedTask[]>('/trash', { projectId: projectId || undefined }) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.trash });
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['board'] });
  };
  const restore = useMutation({
    mutationFn: (t: TrashedTask) => api.post<Task>(`/trash/${t.id}/restore`),
    onSuccess: (task) => {
      refresh();
      toast.info(`${task.key} restored`, { label: 'Open', onClick: () => openTask(task.key) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const purge = useMutation({
    mutationFn: (t: TrashedTask) => api.delete(`/trash/${t.id}`),
    onSuccess: (_d, t) => {
      refresh();
      toast.success(`${t.key} deleted forever`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="page trash-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Recoverable for 30 days</span>
          <h1 className="display-sm">Trash</h1>
        </div>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
          <option value="">All projects</option>
          {projects?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </header>
      <section className="tile">
        {isLoading ? (
          <SkeletonRows rows={4} />
        ) : data?.length ? (
          <ul className="trash-list">
            {data.map((t) => {
              const left = daysLeft(t.purgeAt);
              return (
                <li key={t.id}>
                  <TypeIcon type={t.type} />
                  <span className="task-key">{t.key}</span>
                  <span className="trash-title">
                    <strong className="ellipsis">{t.title}</strong>
                    <span className="muted small">
                      <Link to={`/projects/${t.projectKey}`}>{t.projectName}</Link> · deleted {timeAgo(t.deletedAt)} by {t.deletedBy?.name ?? 'someone'}
                      {t.subtaskCount > 0 && ` · with ${t.subtaskCount} subtask${t.subtaskCount === 1 ? '' : 's'}`}
                    </span>
                  </span>
                  <span className={`trash-left${left <= 3 ? ' soon' : ''}`} title="Permanently deleted after 30 days">
                    {left}d left
                  </span>
                  {canRestore && (
                    <button className="btn btn-soft btn-sm" onClick={() => restore.mutate(t)} disabled={restore.isPending}>
                      <RotateCcw size={13} /> Restore
                    </button>
                  )}
                  {canPurge && (
                    <button className="icon-btn danger" aria-label={`Delete ${t.key} forever`} onClick={() => confirm(`Permanently delete ${t.key} and everything in it? This cannot be undone.`) && purge.mutate(t)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="Trash is empty">Deleted tasks land here and can be restored for 30 days.</EmptyState>
        )}
      </section>
    </div>
  );
}
