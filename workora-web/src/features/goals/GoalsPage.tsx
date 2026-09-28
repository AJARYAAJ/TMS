import { Link2, Plus, Target, Trash2, X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Avatar, Dialog, EmptyState, Ring, SkeletonRows, StatusBadge } from '@/components/ui';
import { Picker } from '@/components/ui/Picker';
import { useCan } from '@/features/auth/session.store';
import { useProjects } from '@/features/projects/api';
import { useOpenTask } from '@/features/tasks/useOpenTask';
import type { Goal, GoalStatus } from '@/types';
import { formatDate } from '@/utils/format';
import { useGoalMutations, useGoals } from './api';

const STATUS: { value: GoalStatus; label: string }[] = [
  { value: 'ON_TRACK', label: 'On track' },
  { value: 'AT_RISK', label: 'At risk' },
  { value: 'OFF_TRACK', label: 'Off track' },
  { value: 'ACHIEVED', label: 'Achieved' },
];

/** Goals & OKRs. Mounted at /goals (all) and as a project tab (filtered). */
export default function GoalsPage() {
  const { projectKey } = useParams();
  const { data, isLoading } = useGoals(projectKey);
  const canEdit = useCan('MEMBER');
  const [creating, setCreating] = useState(false);
  const avg = data?.length ? Math.round(data.reduce((n, g) => n + g.progress, 0) / data.length) : 0;

  return (
    <div className="page">
      {!projectKey && (
        <header className="page-head">
          <div>
            <span className="eyebrow">Objectives & key results</span>
            <h1 className="display-sm">Goals</h1>
          </div>
          {data && data.length > 0 && <Ring value={avg} size={72} stroke={7} label={<><strong>{avg}%</strong><small>overall</small></>} />}
        </header>
      )}
      <div className="toolbar">
        {canEdit && (
          <button className="btn btn-volt" onClick={() => setCreating(true)}>
            <Plus size={15} /> New goal
          </button>
        )}
      </div>
      {isLoading ? (
        <SkeletonRows rows={4} />
      ) : !data?.length ? (
        <EmptyState icon={<Target size={32} />} title="No goals yet">
          Goals connect day-to-day tasks to outcomes. Add measurable key results, link tasks, and watch progress roll up.
        </EmptyState>
      ) : (
        <div className="goal-grid">
          {data.map((g) => (
            <GoalCard key={g.id} goal={g} canEdit={canEdit} />
          ))}
        </div>
      )}
      <CreateGoalDialog open={creating} onClose={() => setCreating(false)} projectKey={projectKey} />
    </div>
  );
}

function GoalCard({ goal, canEdit }: { goal: Goal; canEdit: boolean }) {
  const m = useGoalMutations();
  const openTask = useOpenTask();
  const [krTitle, setKrTitle] = useState('');
  const [taskKey, setTaskKey] = useState('');
  const status = STATUS.find((s) => s.value === goal.status)!;

  return (
    <article className={`tile goal-card gs-${goal.status.toLowerCase()}`}>
      <header className="goal-head">
        <Ring value={goal.progress} size={58} />
        <div className="goal-title">
          <h2>{goal.title}</h2>
          <div className="goal-meta">
            <Picker label="Goal status" value={goal.status} disabled={!canEdit} options={STATUS} onChange={(v) => v && m.update.mutate({ id: goal.id, status: v })}>
              <span className={`pill gs-pill gs-${goal.status.toLowerCase()}`}>{status.label}</span>
            </Picker>
            {goal.project && (
              <span className="pill pill-soft">
                <span className="dot" style={{ background: goal.project.color }} /> {goal.project.name}
              </span>
            )}
            {goal.dueDate && <span className="muted small">Due {formatDate(goal.dueDate)}</span>}
            <span className="ml-auto">
              <Avatar user={goal.owner} size={22} />
            </span>
          </div>
        </div>
        {canEdit && (
          <button className="icon-btn danger" aria-label="Delete goal" onClick={() => confirm(`Delete goal “${goal.title}”?`) && m.remove.mutate(goal.id)}>
            <Trash2 size={15} />
          </button>
        )}
      </header>

      <ul className="kr-list">
        {goal.keyResults.map((kr) => (
          <li key={kr.id}>
            <div className="kr-row">
              <span className="ellipsis">{kr.title}</span>
              <span className="kr-value">
                {kr.kind === 'NUMBER' && canEdit ? (
                  <input
                    type="number"
                    step="any"
                    defaultValue={kr.currentValue}
                    key={kr.currentValue}
                    aria-label={`Current value for ${kr.title}`}
                    onBlur={(e) => Number(e.target.value) !== kr.currentValue && m.updateKr.mutate({ goalId: goal.id, krId: kr.id, currentValue: Number(e.target.value) })}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <strong>{kr.currentValue}</strong>
                )}
                <span className="muted">
                  / {kr.targetValue}
                  {kr.unit && ` ${kr.unit}`}
                  {kr.kind === 'TASKS' && ' tasks'}
                </span>
              </span>
              {canEdit && (
                <button className="icon-btn" aria-label={`Remove ${kr.title}`} onClick={() => m.removeKr.mutate({ goalId: goal.id, krId: kr.id })}>
                  <X size={12} />
                </button>
              )}
            </div>
            <span className="bar">
              <span style={{ width: `${kr.progress}%` }} />
            </span>
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="inline-add"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const tasksKr = /^tasks?$/i.test(krTitle.trim());
            if (krTitle.trim()) m.addKr.mutate({ goalId: goal.id, title: tasksKr ? 'Linked tasks complete' : krTitle.trim(), kind: tasksKr ? 'TASKS' : 'NUMBER' }, { onSuccess: () => setKrTitle('') });
          }}
        >
          <Plus size={14} />
          <input value={krTitle} onChange={(e) => setKrTitle(e.target.value)} placeholder='Add key result (type "tasks" to track linked tasks)' aria-label="New key result" />
        </form>
      )}

      <div className="goal-tasks">
        {goal.tasks.map((t) => (
          <span key={t.id} className="task-chip" onClick={() => openTask(t.key)} role="button" tabIndex={0}>
            <span className="mono">{t.key}</span> <span className="ellipsis">{t.title}</span> <StatusBadge status={t.status} />
            {canEdit && (
              <button
                aria-label={`Unlink ${t.key}`}
                onClick={(e) => {
                  e.stopPropagation();
                  m.unlinkTask.mutate({ goalId: goal.id, taskId: t.id });
                }}
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {canEdit && (
          <form
            className="inline-add compact"
            onSubmit={(e) => {
              e.preventDefault();
              if (taskKey.trim()) m.linkTask.mutate({ goalId: goal.id, taskId: taskKey.trim().toUpperCase() }, { onSuccess: () => setTaskKey('') });
            }}
          >
            <Link2 size={13} />
            <input value={taskKey} onChange={(e) => setTaskKey(e.target.value)} placeholder="Link task, e.g. ECOM-7" aria-label="Link task by key" />
          </form>
        )}
      </div>
    </article>
  );
}

function CreateGoalDialog({ open, onClose, projectKey }: { open: boolean; onClose: () => void; projectKey?: string }) {
  const { create } = useGoalMutations();
  const { data: projects } = useProjects();
  const [form, setForm] = useState({ title: '', description: '', projectId: '', dueDate: '' });
  return (
    <Dialog open={open} onClose={onClose} title="New goal">
      <form
        className="form dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { title: form.title, description: form.description, projectId: form.projectId || projectKey || null, dueDate: form.dueDate || null },
            {
              onSuccess: () => {
                setForm({ title: '', description: '', projectId: '', dueDate: '' });
                onClose();
              },
            },
          );
        }}
      >
        <label>
          Objective
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Make checkout effortless" required autoFocus />
        </label>
        <label>
          Why it matters
          <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <div className="form-row">
          {!projectKey && (
            <label>
              Project
              <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                <option value="">Whole workspace</option>
                {projects?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Target date
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </label>
        </div>
        <div className="dialog-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-volt" disabled={create.isPending}>
            Create goal
          </button>
        </div>
      </form>
    </Dialog>
  );
}
