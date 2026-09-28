import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUiStore } from '@/app/ui.store';
import { Dialog, Spinner } from '@/components/ui';
import { toast } from '@/components/ui/toast';
import { useProjects, useUsers } from '@/features/projects/api';
import { errorMessage } from '@/services/api/client';
import { TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES, TaskPriority, TaskStatus, TaskType } from '@/types';
import { PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL } from '@/utils/format';
import { useCreateTask, useLabels, useTasks } from './api';
import { Picker } from '@/components/ui/Picker';
import { LabelChip } from '@/components/ui';
import { useOpenTask } from './useOpenTask';

export function CreateTaskDialog() {
  const intent = useUiStore((s) => s.createTask);
  const close = useUiStore((s) => s.closeCreateTask);
  const { data: projects } = useProjects();
  const { data: users } = useUsers();
  const create = useCreateTask();
  const openTask = useOpenTask();
  const navigate = useNavigate();
  const [form, setForm] = useState({ projectId: '', title: '', type: 'TASK' as TaskType, status: 'TODO' as TaskStatus, priority: 'MEDIUM' as TaskPriority, assigneeId: '', dueDate: '', description: '', parentId: '', labelIds: [] as string[] });
  const { data: labels } = useLabels();
  const { data: epics } = useTasks({ projectId: form.projectId, type: 'EPIC', size: 100 }, !!form.projectId && !!intent);

  useEffect(() => {
    if (!intent) return;
    const project = projects?.find((p) => p.key === intent.projectId?.toUpperCase() || p.id === intent.projectId) ?? projects?.find((p) => p.status === 'ACTIVE');
    setForm((f) => ({ ...f, projectId: project?.id ?? '', title: '', description: '', status: intent.status ?? 'TODO', dueDate: '', assigneeId: '', parentId: '', labelIds: [] }));
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, projects]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        projectId: form.projectId,
        title: form.title,
        type: form.type,
        status: form.status,
        priority: form.priority,
        assigneeId: form.assigneeId || null,
        dueDate: form.dueDate || null,
        description: form.description,
        sprintId: intent?.sprintId ?? undefined,
        parentId: form.parentId || undefined,
        labelIds: form.labelIds,
      },
      {
        onSuccess: (task) => {
          close();
          toast.info(`${task.key} created`, { label: 'Open', onClick: () => openTask(task.key) });
        },
      },
    );
  };

  const set = <K extends keyof typeof form>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <Dialog open={!!intent} onClose={close} title="Create task" width={560}>
      {projects && projects.length === 0 ? (
        <div className="dialog-body">
          <p>Create a project first.</p>
          <button
            className="btn btn-primary"
            onClick={() => {
              close();
              navigate('/projects');
            }}
          >
            Go to projects
          </button>
        </div>
      ) : (
        <form className="form dialog-body" onSubmit={submit}>
          <label>
            Project
            <select value={form.projectId} onChange={set('projectId')} required>
              {projects?.filter((p) => p.status === 'ACTIVE').map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.key})
                </option>
              ))}
            </select>
          </label>
          <label>
            Title
            <input value={form.title} onChange={set('title')} placeholder="What needs to be done?" required maxLength={500} autoFocus />
          </label>
          <div className="form-row">
            <label>
              Type
              <select value={form.type} onChange={set('type')}>
                {TASK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select value={form.status} onChange={set('status')}>
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select value={form.priority} onChange={set('priority')}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>
              Assignee
              <select value={form.assigneeId} onChange={set('assigneeId')}>
                <option value="">Unassigned</option>
                {users?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Due date
              <input type="date" value={form.dueDate} onChange={set('dueDate')} />
            </label>
          </div>
          <div className="form-row">
            <label>
              Epic
              <select value={form.parentId} onChange={set('parentId')}>
                <option value="">No epic</option>
                {epics?.data.filter((e) => e.type === 'EPIC').map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.key} · {e.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="label-field">
              <span>Labels</span>
              <Picker
                label="Labels"
                value={form.labelIds}
                searchable
                options={(labels ?? []).map((l) => ({ value: l.id, label: l.name, icon: <span className="dot" style={{ background: l.color }} /> }))}
                onChange={(_v, all) => setForm({ ...form, labelIds: all ?? [] })}
              >
                <span className="prop">{form.labelIds.length ? labels?.filter((l) => form.labelIds.includes(l.id)).map((l) => <LabelChip key={l.id} label={l} />) : 'Add labels'}</span>
              </Picker>
            </div>
          </div>
          <label>
            Description
            <textarea rows={3} value={form.description} onChange={set('description')} />
          </label>
          {create.isError && <div className="form-error">{errorMessage(create.error)}</div>}
          <div className="dialog-footer">
            <button type="button" className="btn btn-ghost" onClick={close}>
              Cancel
            </button>
            <button className="btn btn-volt" disabled={create.isPending || !form.projectId}>
              {create.isPending ? <Spinner /> : 'Create task'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
