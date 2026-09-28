import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUiStore } from '@/app/ui.store';
import { Dialog, Spinner } from '@/components/ui';
import { toast } from '@/components/ui/toast';
import { useProjects, useUsers } from '@/features/projects/api';
import { errorMessage } from '@/services/api/client';
import { TASK_PRIORITIES, TASK_TYPES, TaskPriority, TaskType } from '@/types';
import { recurrencePresets } from '@/utils/recurrence';
import { PRIORITY_LABEL, TYPE_LABEL } from '@/utils/format';
import { useCreateTask, useLabels, useTasks, useWorkflow } from './api';
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
  const [form, setForm] = useState({ projectId: '', title: '', type: 'TASK' as TaskType, stateId: '', repeat: 'none', priority: 'MEDIUM' as TaskPriority, assigneeId: '', dueDate: '', description: '', parentId: '', labelIds: [] as string[] });
  const { data: labels } = useLabels();
  const { data: states } = useWorkflow(form.projectId || undefined);
  useEffect(() => {
    // A state picked for another project would be rejected: reset it when the project changes.
    if (form.stateId && states && !states.some((st) => st.id === form.stateId)) setForm((f) => ({ ...f, stateId: '' }));
  }, [states, form.stateId]);
  const { data: epics } = useTasks({ projectId: form.projectId, type: 'EPIC', size: 100 }, !!form.projectId && !!intent);

  useEffect(() => {
    if (!intent) return;
    const project = projects?.find((p) => p.key === intent.projectId?.toUpperCase() || p.id === intent.projectId) ?? projects?.find((p) => p.status === 'ACTIVE');
    setForm((f) => ({ ...f, projectId: project?.id ?? '', title: '', description: '', stateId: intent.stateId ?? '', repeat: 'none', dueDate: '', assigneeId: '', parentId: '', labelIds: [] }));
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
        stateId: form.stateId || undefined,
        status: form.stateId ? undefined : intent?.status,
        recurrence: recurrencePresets(form.dueDate || null).find((p) => p.id === form.repeat)?.rule ?? undefined,
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
              <select value={form.stateId} onChange={set('stateId')}>
                <option value="">{intent?.status ? 'Default for this column' : 'First “to do” state'}</option>
                {states?.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
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
            Repeat
            <select value={form.repeat} onChange={set('repeat')}>
              {recurrencePresets(form.dueDate || null).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
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
