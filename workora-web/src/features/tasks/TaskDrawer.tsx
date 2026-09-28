import { Download, Link2, Paperclip, Trash2, X } from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Avatar, EmptyState, PriorityIcon, Skeleton, SavingIndicator, Spinner, StatusBadge, TypeIcon } from '@/components/ui';
import { toast } from '@/components/ui/toast';
import { useCan, useSession } from '@/features/auth/session.store';
import { useUsers } from '@/features/projects/api';
import { useSprints } from '@/features/sprints/api';
import { ApiError } from '@/services/api/client';
import { Task, TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES } from '@/types';
import { formatBytes, isOverdue, PRIORITY_LABEL, STATUS_LABEL, timeAgo, TYPE_LABEL } from '@/utils/format';
import {
  TaskPatch,
  useAddComment,
  useAttachments,
  useComments,
  useDeleteAttachment,
  useDeleteTask,
  useTask,
  useTaskActivity,
  useUpdateTask,
  useUploadAttachment,
} from './api';
import { useOpenTask, useOpenTaskKey } from './useOpenTask';

/** Task details open in a drawer over whatever screen the user is on — no navigation, no reload. */
export function TaskDrawer() {
  const key = useOpenTaskKey();
  const openTask = useOpenTask();
  const close = () => openTask(null);

  useEffect(() => {
    if (!key) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.overlay .dialog')) return; // a dialog on top handles its own Escape
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={close} />
      <aside className="drawer" role="dialog" aria-label={`Task ${key}`}>
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

  if (isLoading && !task) return <DrawerSkeleton onClose={onClose} />;
  if (error || !task) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="drawer-body">
        <DrawerHeader title={taskKey} onClose={onClose} />
        <EmptyState title={notFound ? 'Task not found' : "Couldn't load task"}>{notFound ? 'It may have been deleted or moved.' : (error as Error)?.message}</EmptyState>
      </div>
    );
  }

  const save = (patch: TaskPatch, optimistic?: Partial<Task>) => update.mutate({ task, patch, optimistic });
  const saving = update.isPending && update.variables?.task.id === task.id;

  return (
    <div className="drawer-body">
      <DrawerHeader
        title={
          <>
            <TypeIcon type={task.type} /> {task.key}
            {isPlaceholderData && <Spinner size={10} />}
          </>
        }
        onClose={onClose}
        actions={
          <>
            <SavingIndicator saving={saving} />
            <button
              className="icon-btn"
              title="Copy link"
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
                title="Delete task"
                onClick={() => {
                  if (confirm(`Delete ${task.key}? This cannot be undone.`)) {
                    del.mutate(task);
                    onClose();
                  }
                }}
              >
                <Trash2 size={16} />
              </button>
            )}
          </>
        }
      />

      <TitleEditor task={task} disabled={!canEdit} onSave={(title) => save({ title })} />

      <TaskFields task={task} disabled={!canEdit} onSave={save} />

      <section className="drawer-section">
        <h3>Description</h3>
        <DescriptionEditor task={task} disabled={!canEdit} onSave={(description) => save({ description })} saving={saving && update.variables?.patch.description !== undefined} />
      </section>

      <Attachments taskKey={task.key} canEdit={canEdit} />

      <Discussion taskKey={task.key} canEdit={canEdit} />
    </div>
  );
}

function DrawerHeader({ title, onClose, actions }: { title: React.ReactNode; onClose: () => void; actions?: React.ReactNode }) {
  return (
    <header className="drawer-header">
      <span className="drawer-key">{title}</span>
      <div className="drawer-actions">
        {actions}
        <button className="icon-btn" onClick={onClose} aria-label="Close task">
          <X size={18} />
        </button>
      </div>
    </header>
  );
}

function DrawerSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <div className="drawer-body" aria-busy="true">
      <DrawerHeader title={<Skeleton width={80} />} onClose={onClose} />
      <Skeleton height={28} width="80%" />
      <div className="field-grid" style={{ marginTop: 20 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} height={32} />
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
      className="title-input"
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

function TaskFields({ task, disabled, onSave }: { task: Task; disabled: boolean; onSave: (p: TaskPatch, o?: Partial<Task>) => void }) {
  const { data: users } = useUsers();
  const { data: sprints } = useSprints(task.projectId);
  const openSprints = sprints?.filter((s) => s.status !== 'COMPLETED') ?? [];

  return (
    <div className="field-grid">
      <Field label="Status">
        <select value={task.status} disabled={disabled} onChange={(e) => onSave({ status: e.target.value as Task['status'] })}>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Priority">
        <div className="with-icon">
          <PriorityIcon priority={task.priority} />
          <select value={task.priority} disabled={disabled} onChange={(e) => onSave({ priority: e.target.value as Task['priority'] })}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
      </Field>
      <Field label="Assignee">
        <div className="with-icon">
          <Avatar user={task.assignee} size={20} />
          <select
            value={task.assignee?.id ?? ''}
            disabled={disabled}
            onChange={(e) => {
              const id = e.target.value || null;
              const user = users?.find((u) => u.id === id) ?? null;
              onSave({ assigneeId: id }, { assignee: user && { id: user.id, name: user.name, email: user.email } });
            }}
          >
            <option value="">Unassigned</option>
            {users?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
            {task.assignee && !users?.some((u) => u.id === task.assignee!.id) && <option value={task.assignee.id}>{task.assignee.name}</option>}
          </select>
        </div>
      </Field>
      <Field label="Type">
        <div className="with-icon">
          <TypeIcon type={task.type} />
          <select value={task.type} disabled={disabled} onChange={(e) => onSave({ type: e.target.value as Task['type'] })}>
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
      </Field>
      <Field label="Sprint">
        <select value={task.sprintId ?? ''} disabled={disabled} onChange={(e) => onSave({ sprintId: e.target.value || null })}>
          <option value="">Backlog</option>
          {openSprints.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.status === 'ACTIVE' ? ' (active)' : ''}
            </option>
          ))}
          {task.sprintId && !openSprints.some((s) => s.id === task.sprintId) && <option value={task.sprintId}>{sprints?.find((s) => s.id === task.sprintId)?.name ?? 'Sprint'}</option>}
        </select>
      </Field>
      <Field label="Story points">
        <input
          type="number"
          min={0}
          max={1000}
          disabled={disabled}
          defaultValue={task.storyPoints ?? ''}
          key={`sp-${task.storyPoints}`}
          onBlur={(e) => {
            const v = e.target.value === '' ? null : Number(e.target.value);
            if (v !== task.storyPoints) onSave({ storyPoints: v });
          }}
        />
      </Field>
      <Field label="Start date">
        <input type="date" disabled={disabled} value={task.startDate ?? ''} onChange={(e) => onSave({ startDate: e.target.value || null })} />
      </Field>
      <Field label={isOverdue(task.dueDate, task.status) ? 'Due date · overdue' : 'Due date'} danger={isOverdue(task.dueDate, task.status)}>
        <input type="date" disabled={disabled} value={task.dueDate ?? ''} onChange={(e) => onSave({ dueDate: e.target.value || null })} />
      </Field>
      <div className="field-meta">
        <span>
          Reporter <Avatar user={task.reporter} size={16} /> {task.reporter?.name}
        </span>
        <span>Created {timeAgo(task.createdAt)}</span>
        <span>Updated {timeAgo(task.updatedAt)}</span>
        <StatusBadge status={task.status} />
      </div>
    </div>
  );
}

function Field({ label, children, danger }: { label: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <label className={`field${danger ? ' field-danger' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function DescriptionEditor({ task, disabled, onSave, saving }: { task: Task; disabled: boolean; onSave: (d: string) => void; saving: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(task.description);
  useEffect(() => {
    if (!editing) setValue(task.description);
  }, [task.description, editing]);

  if (!editing) {
    return (
      <div
        className={`description${task.description ? '' : ' placeholder'}${disabled ? '' : ' editable'}`}
        onClick={() => !disabled && setEditing(true)}
        role={disabled ? undefined : 'button'}
        tabIndex={disabled ? undefined : 0}
        onKeyDown={(e) => e.key === 'Enter' && !disabled && setEditing(true)}
      >
        {task.description || (disabled ? 'No description.' : 'Add a description…')}
        {saving && <SavingIndicator saving />}
      </div>
    );
  }
  return (
    <div className="description-editor">
      <textarea autoFocus rows={6} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Description" />
      <div className="row-actions">
        <button
          className="btn btn-primary btn-sm"
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
      </div>
    </div>
  );
}

function Attachments({ taskKey, canEdit }: { taskKey: string; canEdit: boolean }) {
  const { data, isLoading } = useAttachments(taskKey);
  const upload = useUploadAttachment(taskKey);
  const remove = useDeleteAttachment(taskKey);
  const input = useRef<HTMLInputElement>(null);
  const me = useSession()?.user.id;
  const isAdmin = useCan('ADMIN');

  return (
    <section className="drawer-section">
      <div className="section-title">
        <h3>Attachments {data?.length ? <span className="count">{data.length}</span> : null}</h3>
        {canEdit && (
          <>
            <input ref={input} type="file" hidden onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0], { onSettled: () => (e.target.value = '') })} />
            <button className="btn btn-ghost btn-sm" onClick={() => input.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? (
                <>
                  <Spinner size={10} /> Uploading…
                </>
              ) : (
                <>
                  <Paperclip size={14} /> Attach
                </>
              )}
            </button>
          </>
        )}
      </div>
      {isLoading ? (
        <Skeleton height={36} />
      ) : data?.length ? (
        <ul className="attachments">
          {data.map((a) => (
            <li key={a.id}>
              <Paperclip size={14} />
              <a href={a.downloadUrl} download={a.fileName}>
                {a.fileName}
              </a>
              <span className="muted small">
                {formatBytes(a.size)} · {a.uploader.name} · {timeAgo(a.createdAt)}
              </span>
              <a className="icon-btn ml-auto" href={a.downloadUrl} download={a.fileName} title="Download">
                <Download size={14} />
              </a>
              {canEdit && (a.uploader.id === me || isAdmin) && (
                <button className="icon-btn danger" title="Remove" onClick={() => remove.mutate(a.id)}>
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No attachments.</p>
      )}
    </section>
  );
}

function Discussion({ taskKey, canEdit }: { taskKey: string; canEdit: boolean }) {
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  return (
    <section className="drawer-section">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'comments'} className={tab === 'comments' ? 'active' : ''} onClick={() => setTab('comments')}>
          Comments
        </button>
        <button role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>
          Activity
        </button>
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
        <>
          <Skeleton height={48} />
          <Skeleton height={48} style={{ marginTop: 8 }} />
        </>
      ) : data?.length ? (
        data.map((c) => (
          <div key={c.id} className={`comment${c.pending ? ' pending' : ''}`}>
            <Avatar user={c.author} size={28} />
            <div>
              <div className="comment-meta">
                <strong>{c.author.name}</strong>
                <span className="muted small">{c.pending ? 'Sending…' : timeAgo(c.createdAt)}</span>
              </div>
              <div className="comment-body">{renderMentions(c.body)}</div>
            </div>
          </div>
        ))
      ) : (
        <p className="muted small">No comments yet.</p>
      )}
      {canEdit && (
        <form className="comment-form" onSubmit={submit}>
          <textarea
            rows={2}
            placeholder="Write a comment… use @name to mention someone"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
            }}
            aria-label="New comment"
          />
          <button className="btn btn-primary btn-sm" disabled={!body.trim()}>
            Comment
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
    <ul className="activity">
      {data.map((a) => (
        <li key={a.id}>
          <strong>{a.actor.name}</strong> {a.summary}
          <span className="muted small"> · {timeAgo(a.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

