import {
  AlertOctagon,
  Calendar,
  ChevronRight,
  Clock,
  Copy,
  Download,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  CircleDot,
  Eye,
  EyeOff,
  Flag,
  Gauge,
  GitBranch,
  Link2,
  Paperclip,
  Play,
  Plus,
  Repeat,
  Square,
  Tag,
  Timer,
  Trash2,
  X,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, AvatarStack, EmptyState, formatMinutes, LabelChip, PriorityIcon, Skeleton, SavingIndicator, Spinner, StatusBadge, TypeIcon } from '@/components/ui';
import { Picker } from '@/components/ui/Picker';
import { toast } from '@/components/ui/toast';
import { useCan, useSession } from '@/features/auth/session.store';
import { useUsers } from '@/features/projects/api';
import { useSprints } from '@/features/sprints/api';
import { ApiError } from '@/services/api/client';
import { Recurrence, Task, TASK_PRIORITIES, TASK_TYPES, TaskDetail } from '@/types';
import { describeRecurrence, recurrencePresets } from '@/utils/recurrence';
import { formatBytes, formatDate, isOverdue, PRIORITY_LABEL, STATUS_LABEL, timeAgo, TYPE_LABEL } from '@/utils/format';
import { renderMarkdown } from '@/utils/markdown';
import {
  TaskPatch,
  useAddComment,
  useAttachments,
  useComments,
  useCreateLabel,
  useCreateTask,
  useDeleteAttachment,
  useDeleteTask,
  useLabels,
  useLinkMutations,
  useRunningTimer,
  useSubtasks,
  useTask,
  useTaskActivity,
  useTimeEntries,
  useTimer,
  useUpdateTask,
  useUploadAttachment,
  useWatch,
  useWorkflow,
} from './api';
import { useOpenTask, useOpenTaskKey } from './useOpenTask';
import { CustomFieldsSection } from '@/features/fields/FieldValues';

/** Task sheet: floats over the current screen (no navigation) and edits everything inline. */
export function TaskDrawer() {
  const key = useOpenTaskKey();
  const openTask = useOpenTask();
  const close = () => openTask(null);

  useEffect(() => {
    if (!key) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('.overlay .dialog, .picker-pop')) return; // let the topmost layer handle it
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={close} />
      <aside className="sheet" role="dialog" aria-label={`Task ${key}`}>
        <TaskDetails taskKey={key} onClose={close} />
      </aside>
    </>
  );
}

function TaskDetails({ taskKey, onClose }: { taskKey: string; onClose: () => void }) {
  const { data: task, isLoading, error, isPlaceholderData } = useTask(taskKey);
  const canEdit = useCan('MEMBER');
  const update = useUpdateTask();
  const del = useDeleteTask();
  const openTask = useOpenTask();

  if (isLoading && !task) return <SheetSkeleton onClose={onClose} />;
  if (error || !task) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="sheet-body">
        <SheetHeader onClose={onClose}>{taskKey}</SheetHeader>
        <EmptyState title={notFound ? 'Task not found' : "Couldn't load task"}>{notFound ? 'It may have been deleted.' : (error as Error)?.message}</EmptyState>
      </div>
    );
  }

  const save = (patch: TaskPatch, optimistic?: Partial<Task>) => update.mutate({ task, patch, optimistic });
  const saving = update.isPending && update.variables?.task.id === task.id;

  return (
    <div className="sheet-body">
      <SheetHeader
        onClose={onClose}
        actions={
          <>
            <SavingIndicator saving={saving} />
            {isPlaceholderData && <Spinner size={10} />}
            <TimerButton task={task} />
            <WatchButton task={task} />
            <button
              className="icon-btn"
              title="Copy link"
              aria-label="Copy link"
              onClick={() => {
                navigator.clipboard?.writeText(window.location.href);
                toast.success('Link copied');
              }}
            >
              <Link2 size={16} />
            </button>
            {canEdit && (
              <button
                className="icon-btn danger"
                title="Move to trash"
                aria-label="Delete task"
                onClick={() => {
                  // Goes to the trash with an Undo toast, so no confirmation step.
                  del.mutate(task);
                  onClose();
                }}
              >
                <Trash2 size={16} />
              </button>
            )}
          </>
        }
      >
        <Picker label="Type" value={task.type} disabled={!canEdit} options={TASK_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t], icon: <TypeIcon type={t} /> }))} onChange={(v) => v && save({ type: v })}>
          <span className="sheet-key">
            <TypeIcon type={task.type} /> {task.key}
          </span>
        </Picker>
        {task.parent && (
          <button className="crumb" onClick={() => openTask(task.parent!.key)} title={task.parent.title}>
            <ChevronRight size={13} />
            <TypeIcon type={task.parent.type} /> <span className="ellipsis">{task.parent.title}</span>
          </button>
        )}
      </SheetHeader>

      <TitleEditor task={task} disabled={!canEdit} onSave={(title) => save({ title })} />

      {task.blockedBy > 0 && (
        <div className="banner banner-danger">
          <AlertOctagon size={15} /> Blocked by {task.blockedBy} open {task.blockedBy === 1 ? 'task' : 'tasks'} — see Dependencies below.
        </div>
      )}

      <PropertyPills task={task} disabled={!canEdit} onSave={save} />

      <section className="sheet-section">
        <h3>Description</h3>
        <DescriptionEditor task={task} disabled={!canEdit} onSave={(description) => save({ description })} />
      </section>

      <CustomFieldsSection task={task} canEdit={canEdit} onSave={(patch, optimistic) => save(patch, optimistic)} />
      <Subtasks task={task} canEdit={canEdit} />
      <Dependencies task={task} canEdit={canEdit} />
      <Development task={task} />
      <TimeSection task={task} canEdit={canEdit} />
      <Attachments taskKey={task.key} canEdit={canEdit} />
      <Discussion taskKey={task.key} canEdit={canEdit} />

      <footer className="sheet-foot muted small">
        Created by {task.reporter?.name} {timeAgo(task.createdAt)} · updated {timeAgo(task.updatedAt)}
      </footer>
    </div>
  );
}

function SheetHeader({ children, onClose, actions }: { children: React.ReactNode; onClose: () => void; actions?: React.ReactNode }) {
  return (
    <header className="sheet-header">
      <div className="sheet-crumbs">{children}</div>
      <div className="sheet-actions">
        {actions}
        <button className="icon-btn" onClick={onClose} aria-label="Close task">
          <X size={18} />
        </button>
      </div>
    </header>
  );
}

function SheetSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <div className="sheet-body" aria-busy="true">
      <SheetHeader onClose={onClose}>
        <Skeleton width={80} />
      </SheetHeader>
      <Skeleton height={34} width="80%" />
      <div className="pills" style={{ marginTop: 18 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} height={30} width={96} radius={15} />
        ))}
      </div>
      <Skeleton height={90} style={{ marginTop: 24 }} />
    </div>
  );
}

function TitleEditor({ task, disabled, onSave }: { task: Task; disabled: boolean; onSave: (t: string) => void }) {
  const [value, setValue] = useState(task.title);
  useEffect(() => setValue(task.title), [task.title]);
  const commit = () => {
    const v = value.trim();
    if (v && v !== task.title) onSave(v);
    else setValue(task.title);
  };
  return (
    <textarea
      className="sheet-title"
      value={value}
      rows={1}
      disabled={disabled}
      aria-label="Task title"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}

/** Every property is a pill; clicking opens a picker. Changes apply optimistically. */
function PropertyPills({ task, disabled, onSave }: { task: TaskDetail; disabled: boolean; onSave: (p: TaskPatch, o?: Partial<Task>) => void }) {
  const { data: users } = useUsers();
  const { data: sprints } = useSprints(task.projectId);
  const { data: labels } = useLabels();
  const { data: states } = useWorkflow(task.projectId);
  const createLabel = useCreateLabel();
  const openSprints = sprints?.filter((s) => s.status !== 'COMPLETED') ?? [];
  const sprintName = sprints?.find((s) => s.id === task.sprintId)?.name;
  const overdue = isOverdue(task.dueDate, task.status);

  return (
    <div className="pills" role="group" aria-label="Task properties">
      <Picker
        label="Status"
        value={task.stateId}
        disabled={disabled}
        options={(states ?? []).map((st) => ({ value: st.id, label: st.name, hint: STATUS_LABEL[st.category], icon: <span className="status-dot" style={{ ['--st' as any]: st.color }} /> }))}
        onChange={(id) => {
          const st = states?.find((x) => x.id === id);
          if (st) onSave({ stateId: st.id }, { stateId: st.id, state: st, status: st.category });
        }}
      >
        <span className={`prop prop-status status-${task.status.toLowerCase()}`} style={task.state ? { ['--st' as any]: task.state.color } : undefined}>
          <span className="status-dot" /> {task.state?.name ?? STATUS_LABEL[task.status]}
        </span>
      </Picker>

      <Picker label="Priority" value={task.priority} disabled={disabled} options={TASK_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p], icon: <PriorityIcon priority={p} /> }))} onChange={(v) => v && onSave({ priority: v })}>
        <span className="prop">
          <PriorityIcon priority={task.priority} /> {PRIORITY_LABEL[task.priority]}
        </span>
      </Picker>

      <Picker
        label="Assignee"
        value={task.assignee?.id ?? null}
        disabled={disabled}
        searchable
        clearLabel="Unassigned"
        options={(users ?? []).map((u) => ({ value: u.id, label: u.name, icon: <Avatar user={u} size={18} />, hint: u.email }))}
        onChange={(id) => {
          const u = users?.find((x) => x.id === id);
          onSave({ assigneeId: id }, { assignee: u ? { id: u.id, name: u.name, email: u.email } : null });
        }}
      >
        <span className="prop">
          <Avatar user={task.assignee} size={18} /> {task.assignee?.name ?? 'Unassigned'}
        </span>
      </Picker>

      <Picker
        label="Labels"
        value={task.labels.map((l) => l.id)}
        disabled={disabled}
        searchable
        options={(labels ?? []).map((l) => ({ value: l.id, label: l.name, icon: <span className="dot" style={{ background: l.color }} /> }))}
        onChange={(_v, all) => {
          const next = (labels ?? []).filter((l) => all!.includes(l.id));
          onSave({ labelIds: all }, { labels: next.map(({ id, name, color }) => ({ id, name, color })) });
        }}
        footer={(close, q) =>
          q.trim() && !labels?.some((l) => l.name.toLowerCase() === q.trim().toLowerCase()) ? (
            <button
              className="picker-item picker-create"
              onClick={() =>
                createLabel.mutate(
                  { name: q.trim(), color: ['#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'][q.length % 5] },
                  {
                    onSuccess: (l) => {
                      onSave({ labelIds: [...task.labels.map((x) => x.id), l.id] }, { labels: [...task.labels, l] });
                      close();
                    },
                  },
                )
              }
            >
              <Plus size={14} /> Create label “{q.trim()}”
            </button>
          ) : null
        }
      >
        <span className="prop">
          <Tag size={13} />
          {task.labels.length ? task.labels.map((l) => <LabelChip key={l.id} label={l} />) : 'Labels'}
        </span>
      </Picker>

      <Picker
        label="Sprint"
        value={task.sprintId}
        disabled={disabled}
        clearLabel="Backlog"
        options={openSprints.map((s) => ({ value: s.id, label: s.name, hint: s.status === 'ACTIVE' ? 'active' : undefined }))}
        onChange={(v) => onSave({ sprintId: v })}
      >
        <span className="prop">
          <GitBranch size={13} /> {task.sprintId ? (sprintName ?? 'Sprint') : 'Backlog'}
        </span>
      </Picker>

      <label className={`prop prop-date${overdue ? ' overdue' : ''}`} title="Due date">
        <Calendar size={13} />
        <span>{task.dueDate ? `Due ${formatDate(task.dueDate)}` : 'Due date'}</span>
        <input type="date" disabled={disabled} value={task.dueDate ?? ''} onChange={(e) => onSave({ dueDate: e.target.value || null })} aria-label="Due date" />
      </label>

      <label className="prop prop-date" title="Start date">
        <Flag size={13} />
        <span>{task.startDate ? `Starts ${formatDate(task.startDate)}` : 'Start'}</span>
        <input type="date" disabled={disabled} value={task.startDate ?? ''} onChange={(e) => onSave({ startDate: e.target.value || null })} aria-label="Start date" />
      </label>

      <RepeatPicker task={task} disabled={disabled} onSave={(recurrence) => onSave({ recurrence }, { recurrence })} />

      <NumberPill icon={<Gauge size={13} />} label="Story points" value={task.storyPoints} suffix="pts" disabled={disabled} onSave={(v) => onSave({ storyPoints: v })} />
      <NumberPill icon={<Timer size={13} />} label="Estimate (hours)" value={task.estimateMinutes === null ? null : +(task.estimateMinutes / 60).toFixed(2)} suffix="h est" disabled={disabled} step={0.25} onSave={(v) => onSave({ estimateMinutes: v === null ? null : Math.round(v * 60) })} />
    </div>
  );
}

/** "Repeat" pill: presets plus a custom rule (every N days/weeks/months, weekdays, end date). */
function RepeatPicker({ task, disabled, onSave }: { task: Task; disabled: boolean; onSave: (r: Recurrence | null) => void }) {
  const presets = recurrencePresets(task.dueDate);
  const current = presets.find((p) => JSON.stringify(p.rule) === JSON.stringify(task.recurrence))?.id ?? (task.recurrence ? 'custom' : 'none');
  const [custom, setCustom] = useState<Recurrence>(task.recurrence ?? { freq: 'WEEKLY', interval: 1, byWeekday: [] });
  useEffect(() => {
    if (task.recurrence) setCustom(task.recurrence);
  }, [task.recurrence]);
  const toggleDay = (d: number) => {
    const days = new Set(custom.byWeekday ?? []);
    days.has(d) ? days.delete(d) : days.add(d);
    setCustom({ ...custom, byWeekday: [...days].sort() });
  };
  return (
    <Picker
      label="Repeat"
      value={current === 'custom' ? null : current}
      disabled={disabled}
      options={presets.map((p) => ({ value: p.id, label: p.label, icon: <Repeat size={13} /> }))}
      onChange={(id) => onSave(presets.find((p) => p.id === id)?.rule ?? null)}
      footer={(close) => (
        <form
          className="repeat-custom"
          onSubmit={(e) => {
            e.preventDefault();
            const rule: Recurrence = { freq: custom.freq, interval: Math.max(1, custom.interval ?? 1) };
            if (custom.freq === 'WEEKLY' && custom.byWeekday?.length) rule.byWeekday = custom.byWeekday;
            if (custom.endDate) rule.endDate = custom.endDate;
            onSave(rule);
            close();
          }}
        >
          <span className="eyebrow">Custom</span>
          <div className="repeat-row">
            Every
            <input type="number" min={1} max={365} value={custom.interval ?? 1} onChange={(e) => setCustom({ ...custom, interval: Number(e.target.value) })} aria-label="Repeat interval" />
            <select value={custom.freq} onChange={(e) => setCustom({ ...custom, freq: e.target.value as Recurrence['freq'] })} aria-label="Repeat unit">
              <option value="DAILY">day(s)</option>
              <option value="WEEKLY">week(s)</option>
              <option value="MONTHLY">month(s)</option>
              <option value="YEARLY">year(s)</option>
            </select>
          </div>
          {custom.freq === 'WEEKLY' && (
            <div className="weekday-toggles" role="group" aria-label="Repeat on">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((l, d) => (
                <button type="button" key={d} className={custom.byWeekday?.includes(d) ? 'on' : ''} onClick={() => toggleDay(d)} aria-pressed={!!custom.byWeekday?.includes(d)}>
                  {l}
                </button>
              ))}
            </div>
          )}
          <label className="repeat-row">
            Until
            <input type="date" value={custom.endDate ?? ''} onChange={(e) => setCustom({ ...custom, endDate: e.target.value || null })} aria-label="Repeat until" />
          </label>
          <button className="btn btn-ink btn-sm btn-block">Apply</button>
        </form>
      )}
    >
      <span className={`prop${task.recurrence ? ' prop-on' : ''}`}>
        <Repeat size={13} /> {task.recurrence ? describeRecurrence(task.recurrence) : 'Repeat'}
      </span>
    </Picker>
  );
}

function NumberPill({ icon, label, value, suffix, disabled, onSave, step = 1 }: { icon: React.ReactNode; label: string; value: number | null; suffix: string; disabled: boolean; onSave: (v: number | null) => void; step?: number }) {
  const [editing, setEditing] = useState(false);
  if (editing && !disabled) {
    return (
      <span className="prop prop-edit">
        {icon}
        <input
          type="number"
          min={0}
          step={step}
          autoFocus
          defaultValue={value ?? ''}
          aria-label={label}
          onBlur={(e) => {
            setEditing(false);
            const v = e.target.value === '' ? null : Number(e.target.value);
            if (v !== value) onSave(v);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </span>
    );
  }
  return (
    <button className="prop" onClick={() => setEditing(true)} disabled={disabled} aria-label={label}>
      {icon} {value === null ? label.split(' ')[0] : `${value} ${suffix}`}
    </button>
  );
}

function DescriptionEditor({ task, disabled, onSave }: { task: Task; disabled: boolean; onSave: (d: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(task.description);
  const openTask = useOpenTask();
  useEffect(() => {
    if (!editing) setValue(task.description);
  }, [task.description, editing]);
  const html = useMemo(() => renderMarkdown(task.description), [task.description]);

  if (!editing) {
    return task.description ? (
      <div
        className={`md description${disabled ? '' : ' editable'}`}
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={(e) => {
          const a = (e.target as HTMLElement).closest('a');
          if (a?.classList.contains('md-task')) {
            e.preventDefault();
            openTask(a.dataset.task!);
          } else if (!a && !disabled) setEditing(true);
        }}
      />
    ) : (
      <button className="description placeholder" onClick={() => !disabled && setEditing(true)} disabled={disabled}>
        {disabled ? 'No description.' : 'Add a description… (markdown supported)'}
      </button>
    );
  }
  return (
    <div className="description-editor">
      <textarea autoFocus rows={7} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Description" />
      <div className="row-actions">
        <button
          className="btn btn-ink btn-sm"
          onClick={() => {
            if (value !== task.description) onSave(value);
            setEditing(false);
          }}
        >
          Save
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <span className="muted small ml-auto">**bold** · *italic* · `code` · - list · - [ ] todo · ECOM-12</span>
      </div>
    </div>
  );
}

function TimerButton({ task }: { task: Task }) {
  const { data: timer } = useRunningTimer();
  const { start, stop } = useTimer();
  const canEdit = useCan('MEMBER');
  if (!canEdit) return null;
  const running = timer?.taskId === task.id;
  return running ? (
    <button className="btn btn-ink btn-sm timer-btn running" onClick={() => stop.mutate()} aria-label="Stop timer">
      <Square size={11} fill="currentColor" /> Stop
    </button>
  ) : (
    <button className="btn btn-soft btn-sm timer-btn" onClick={() => start.mutate(task.key)} disabled={start.isPending} aria-label="Start timer">
      <Play size={11} fill="currentColor" /> Track
    </button>
  );
}

function WatchButton({ task }: { task: TaskDetail }) {
  const me = useSession()!.user;
  const watch = useWatch(task.key);
  const watching = !!task.watchers?.some((w) => w.id === me.id);
  return (
    <button className={`icon-btn${watching ? ' on' : ''}`} title={watching ? 'Stop watching' : 'Watch — get notified about changes'} aria-label={watching ? 'Unwatch task' : 'Watch task'} aria-pressed={watching} onClick={() => watch.mutate({ userId: me.id, on: !watching })}>
      {watching ? <Eye size={16} /> : <EyeOff size={16} />}
    </button>
  );
}

function Subtasks({ task, canEdit }: { task: Task; canEdit: boolean }) {
  const { data, isLoading } = useSubtasks(task.key);
  const create = useCreateTask();
  const update = useUpdateTask();
  const openTask = useOpenTask();
  const [title, setTitle] = useState('');
  const done = data?.filter((t) => t.status === 'DONE').length ?? 0;
  const total = data?.length ?? 0;
  const noun = task.type === 'EPIC' ? 'Tasks in this epic' : 'Subtasks';

  return (
    <section className="sheet-section">
      <div className="section-title">
        <h3>
          {noun} {total > 0 && <span className="count">{done}/{total}</span>}
        </h3>
        {total > 0 && (
          <span className="mini-bar">
            <span style={{ width: `${(done / total) * 100}%` }} />
          </span>
        )}
      </div>
      {isLoading ? (
        <Skeleton height={30} />
      ) : (
        <ul className="subtasks">
          {data?.map((s) => (
            <li key={s.id} className={s.status === 'DONE' ? 'done' : ''}>
              <input
                type="checkbox"
                checked={s.status === 'DONE'}
                disabled={!canEdit}
                aria-label={`Mark ${s.key} ${s.status === 'DONE' ? 'not done' : 'done'}`}
                onChange={(e) => update.mutate({ task: s, patch: { status: e.target.checked ? 'DONE' : 'TODO' } })}
              />
              <button className="link-btn" onClick={() => openTask(s.key)}>
                <span className="mono">{s.key}</span> <span className="ellipsis">{s.title}</span>
              </button>
              <Avatar user={s.assignee} size={20} />
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form
          className="inline-add"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (title.trim()) create.mutate({ projectId: task.projectId, title: title.trim(), parentId: task.id, sprintId: task.sprintId ?? undefined }, { onSuccess: () => setTitle('') });
          }}
        >
          <Plus size={14} />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={task.type === 'EPIC' ? 'Add a task to this epic' : 'Add a subtask'} aria-label="New subtask" disabled={create.isPending} />
        </form>
      )}
    </section>
  );
}

function Dependencies({ task, canEdit }: { task: TaskDetail; canEdit: boolean }) {
  const { add, remove } = useLinkMutations(task);
  const openTask = useOpenTask();
  const [kind, setKind] = useState('blocked_by');
  const [target, setTarget] = useState('');
  const links = task.links ?? [];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!target.trim()) return;
    const [type, direction] = kind === 'blocked_by' ? ['BLOCKS', 'incoming'] : kind === 'blocks' ? ['BLOCKS', 'outgoing'] : kind === 'duplicates' ? ['DUPLICATES', 'outgoing'] : ['RELATES', 'outgoing'];
    add.mutate({ targetId: target.trim().toUpperCase(), type, direction: direction as 'incoming' | 'outgoing' }, { onSuccess: () => setTarget('') });
  };
  return (
    <section className="sheet-section">
      <div className="section-title">
        <h3>Dependencies {links.length > 0 && <span className="count">{links.length}</span>}</h3>
      </div>
      {links.length > 0 && (
        <ul className="links">
          {links.map((l) => (
            <li key={l.id} className={l.relation === 'blocked by' && l.task.status !== 'DONE' ? 'blocking' : ''}>
              <span className="link-rel">{l.relation}</span>
              <button className="link-btn" onClick={() => openTask(l.task.key)}>
                <span className="mono">{l.task.key}</span> <span className="ellipsis">{l.task.title}</span>
              </button>
              <StatusBadge status={l.task.status} />
              {canEdit && (
                <button className="icon-btn" aria-label={`Remove link to ${l.task.key}`} onClick={() => remove.mutate(l.id)}>
                  <X size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form className="inline-add" onSubmit={submit}>
          <Link2 size={14} />
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Relation">
            <option value="blocked_by">is blocked by</option>
            <option value="blocks">blocks</option>
            <option value="relates">relates to</option>
            <option value="duplicates">duplicates</option>
          </select>
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Task key, e.g. ECOM-4" aria-label="Linked task key" />
          <button className="btn btn-soft btn-sm" disabled={add.isPending || !target.trim()}>
            Link
          </button>
        </form>
      )}
    </section>
  );
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');

function DevIcon({ link }: { link: NonNullable<TaskDetail['devLinks']>[number] }) {
  if (link.kind === 'commit') return <GitCommitHorizontal size={15} />;
  if (link.kind === 'issue') return <CircleDot size={15} className={link.state === 'closed' ? 'dev-closed' : 'dev-open'} />;
  if (link.state === 'merged') return <GitMerge size={15} className="dev-merged" />;
  if (link.state === 'closed') return <GitPullRequestClosed size={15} className="dev-closed" />;
  if (link.state === 'draft') return <GitPullRequestDraft size={15} className="dev-draft" />;
  return <GitPullRequest size={15} className="dev-open" />;
}

/** Linked pull requests, commits and issues from GitHub, plus a ready-made branch name. */
function Development({ task }: { task: TaskDetail }) {
  const links = task.devLinks ?? [];
  const branch = `${task.key.toLowerCase()}-${slug(task.title)}`;
  const copy = (text: string, what: string) => navigator.clipboard?.writeText(text).then(() => toast.success(`${what} copied`));
  return (
    <section className="sheet-section">
      <div className="section-title">
        <h3>
          <GitBranch size={14} /> Development {links.length > 0 && <span className="count">{links.length}</span>}
        </h3>
        <span className="dev-actions">
          <button className="btn btn-soft btn-sm" onClick={() => copy(branch, 'Branch name')} title={branch}>
            <Copy size={12} /> Branch name
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => copy(`${task.key} ${task.title}`, 'Commit message')}>
            <Copy size={12} /> Commit msg
          </button>
        </span>
      </div>
      {links.length ? (
        <ul className="dev-links">
          {links.map((l) => (
            <li key={l.id}>
              <DevIcon link={l} />
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="ellipsis">
                {l.title}
              </a>
              {l.state && l.kind !== 'commit' && <span className={`dev-state ds-${l.state}`}>{l.state}</span>}
              <span className="muted small">
                {l.author && `@${l.author} · `}
                {timeAgo(l.updatedAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">
          Mention <code>{task.key}</code> in a branch, commit or pull request on a connected GitHub repo to link it here.
        </p>
      )}
    </section>
  );
}

/** Parses "1h 30m", "90", "1.5h" → minutes. */
function parseDuration(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  const h = t.match(/(\d+(?:\.\d+)?)\s*h/);
  const m = t.match(/(\d+)\s*m/);
  if (h || m) return Math.round((h ? parseFloat(h[1]) * 60 : 0) + (m ? parseInt(m[1], 10) : 0));
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function TimeSection({ task, canEdit }: { task: Task; canEdit: boolean }) {
  const { data } = useTimeEntries(task.key);
  const { log } = useTimer();
  const [value, setValue] = useState('');
  const [showAll, setShowAll] = useState(false);
  const pct = task.estimateMinutes ? Math.min(100, (task.loggedMinutes / task.estimateMinutes) * 100) : 0;
  const over = !!task.estimateMinutes && task.loggedMinutes > task.estimateMinutes;
  const entries = (data ?? []).slice(0, showAll ? undefined : 3);

  return (
    <section className="sheet-section">
      <div className="section-title">
        <h3>
          <Clock size={14} /> Time
        </h3>
        <span className={`muted small${over ? ' text-danger' : ''}`}>
          {formatMinutes(task.loggedMinutes)} logged{task.estimateMinutes ? ` of ${formatMinutes(task.estimateMinutes)}` : ''}
        </span>
      </div>
      {!!task.estimateMinutes && (
        <span className={`mini-bar wide${over ? ' over' : ''}`}>
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
      {canEdit && (
        <form
          className="inline-add"
          onSubmit={(e) => {
            e.preventDefault();
            const minutes = parseDuration(value);
            if (!minutes) return toast.error('Enter time like 45m, 1h 30m or 1.5h');
            log.mutate({ taskKey: task.key, minutes }, { onSuccess: () => setValue('') });
          }}
        >
          <Timer size={14} />
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Log time: 45m, 1h 30m…" aria-label="Log time" />
          <button className="btn btn-soft btn-sm" disabled={!value.trim() || log.isPending}>
            Log
          </button>
        </form>
      )}
      {entries.length > 0 && (
        <ul className="time-entries">
          {entries.map((e) => (
            <li key={e.id}>
              <Avatar user={e.user} size={18} />
              <span>{e.user.name}</span>
              <span className="muted small">{e.note}</span>
              <span className="ml-auto">{e.running ? <span className="pill pill-volt">running</span> : formatMinutes(e.minutes)}</span>
              <span className="muted small">{timeAgo(e.startedAt)}</span>
            </li>
          ))}
        </ul>
      )}
      {(data?.length ?? 0) > 3 && (
        <button className="link-btn small" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show less' : `Show all ${data!.length} entries`}
        </button>
      )}
    </section>
  );
}

function Attachments({ taskKey, canEdit }: { taskKey: string; canEdit: boolean }) {
  const { data, isLoading } = useAttachments(taskKey);
  const upload = useUploadAttachment(taskKey);
  const remove = useDeleteAttachment(taskKey);
  const input = useRef<HTMLInputElement>(null);
  const me = useSession()?.user.id;
  const isAdmin = useCan('ADMIN');
  const [drag, setDrag] = useState(false);

  return (
    <section
      className={`sheet-section${drag ? ' dropping' : ''}`}
      onDragOver={(e) => {
        if (!canEdit || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f && canEdit) upload.mutate(f);
      }}
    >
      <div className="section-title">
        <h3>
          <Paperclip size={14} /> Files {data?.length ? <span className="count">{data.length}</span> : null}
        </h3>
        {canEdit && (
          <>
            <input ref={input} type="file" hidden onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0], { onSettled: () => (e.target.value = '') })} />
            <button className="btn btn-soft btn-sm" onClick={() => input.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? (
                <>
                  <Spinner size={10} /> Uploading…
                </>
              ) : (
                'Attach'
              )}
            </button>
          </>
        )}
      </div>
      {isLoading ? (
        <Skeleton height={36} />
      ) : data?.length ? (
        <ul className="files">
          {data.map((a) => (
            <li key={a.id}>
              <span className="file-ext">{a.fileName.split('.').pop()?.slice(0, 4).toUpperCase() || 'FILE'}</span>
              <a href={a.downloadUrl} download={a.fileName} className="ellipsis">
                {a.fileName}
              </a>
              <span className="muted small">
                {formatBytes(a.size)} · {a.uploader.name}
              </span>
              <a className="icon-btn ml-auto" href={a.downloadUrl} download={a.fileName} aria-label={`Download ${a.fileName}`}>
                <Download size={14} />
              </a>
              {canEdit && (a.uploader.id === me || isAdmin) && (
                <button className="icon-btn danger" aria-label={`Remove ${a.fileName}`} onClick={() => remove.mutate(a.id)}>
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        canEdit && <p className="muted small drop-hint">Drop a file here or click Attach.</p>
      )}
    </section>
  );
}

function Discussion({ taskKey, canEdit }: { taskKey: string; canEdit: boolean }) {
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  const { data: task } = useTask(taskKey);
  const watch = useWatch(taskKey);
  const { data: users } = useUsers();
  return (
    <section className="sheet-section">
      <div className="section-title">
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={tab === 'comments'} className={tab === 'comments' ? 'active' : ''} onClick={() => setTab('comments')}>
            Comments
          </button>
          <button role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>
            Activity
          </button>
        </div>
        <span className="watchers">
          {task?.watchers && <AvatarStack users={task.watchers} />}
          {canEdit && (
            <Picker
              label="Watchers"
              value={(task?.watchers ?? []).map((w) => w.id)}
              searchable
              align="right"
              options={(users ?? []).map((u) => ({ value: u.id, label: u.name, icon: <Avatar user={u} size={18} /> }))}
              onChange={(id, all) => id && watch.mutate({ userId: id, on: all!.includes(id) })}
            >
              <span className="prop prop-sm">
                <Eye size={12} /> {task?.watchers?.length ?? 0}
              </span>
            </Picker>
          )}
        </span>
      </div>
      {tab === 'comments' ? <Comments taskKey={taskKey} canEdit={canEdit} /> : <ActivityFeed taskKey={taskKey} />}
    </section>
  );
}

function Comments({ taskKey, canEdit }: { taskKey: string; canEdit: boolean }) {
  const { data, isLoading } = useComments(taskKey);
  const add = useAddComment(taskKey);
  const [body, setBody] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    add.mutate(body.trim());
    setBody('');
  };
  return (
    <div className="comments">
      {isLoading ? (
        <Skeleton height={48} />
      ) : data?.length ? (
        data.map((c) => (
          <div key={c.id} className={`comment${c.pending ? ' pending' : ''}`}>
            <Avatar user={c.author} size={28} />
            <div className="comment-bubble">
              <div className="comment-meta">
                <strong>{c.author.name}</strong>
                <span className="muted small">{c.pending ? 'Sending…' : timeAgo(c.createdAt)}</span>
              </div>
              <div className="comment-body">{renderMentions(c.body)}</div>
            </div>
          </div>
        ))
      ) : (
        <p className="muted small">No comments yet — start the conversation.</p>
      )}
      {canEdit && (
        <form className="comment-form" onSubmit={submit}>
          <textarea
            rows={2}
            placeholder="Write a comment… @name to mention · Ctrl+Enter to send"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
            }}
            aria-label="New comment"
          />
          <button className="btn btn-ink btn-sm" disabled={!body.trim()}>
            Send
          </button>
        </form>
      )}
    </div>
  );
}

function renderMentions(text: string) {
  return text.split(/(@[\w.+-]+(?:@[\w.-]+)?)/g).map((part, i) =>
    part.startsWith('@') ? (
      <span key={i} className="mention">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function ActivityFeed({ taskKey }: { taskKey: string }) {
  const { data, isLoading } = useTaskActivity(taskKey);
  if (isLoading) return <Skeleton height={60} />;
  if (!data?.length) return <p className="muted small">No activity yet.</p>;
  return (
    <ol className="stream compact">
      {data.map((a) => (
        <li key={a.id}>
          <Avatar user={a.actor.id ? { id: a.actor.id, name: a.actor.name } : null} size={20} />
          <span>
            <strong>{a.actor.name}</strong> {a.summary}
          </span>
          <time className="muted small">{timeAgo(a.createdAt)}</time>
        </li>
      ))}
    </ol>
  );
}
