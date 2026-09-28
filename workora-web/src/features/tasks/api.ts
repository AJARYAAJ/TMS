import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/toast';
import { api, errorMessage } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import { useSessionStore } from '@/features/auth/session.store';
import type { Activity, Attachment, Board, Comment, Label, Task, TaskDetail, TaskLinkItem, TaskPriority, TaskType, TimeEntry, UserSummary, WorkflowState } from '@/types';
import { findCachedTask, invalidateTaskViews, patchCachedTask, removeCachedTask, snapshotTaskCaches } from './cache';

export interface TaskFilters {
  projectId?: string;
  status?: string;
  assigneeId?: string;
  sprintId?: string;
  type?: TaskType;
  priority?: TaskPriority;
  q?: string;
  labelId?: string;
  stateId?: string;
  parentId?: string;
  open?: 'true' | 'false';
  dueFrom?: string;
  dueTo?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  size?: number;
}

export type TaskPatch = Partial<Pick<Task, 'title' | 'description' | 'type' | 'status' | 'stateId' | 'priority' | 'sprintId' | 'storyPoints' | 'startDate' | 'dueDate' | 'parentId' | 'estimateMinutes' | 'recurrence'>> & {
  assigneeId?: string | null;
  labelIds?: string[];
};

export function useTasks(filters: TaskFilters, enabled = true) {
  return useQuery({
    queryKey: qk.tasks(filters as Record<string, unknown>),
    queryFn: () => api.raw<Task[]>('GET', '/tasks', { query: filters as Record<string, string> }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useBoard(projectId: string | undefined, sprintId?: string) {
  return useQuery({
    queryKey: [...qk.board(projectId ?? ''), sprintId ?? 'all'],
    queryFn: () => api.get<Board>(`/projects/${projectId}/board`, sprintId ? { sprintId } : undefined),
    enabled: !!projectId,
  });
}

export function useTask(key: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.task(key ?? ''),
    queryFn: () => api.get<TaskDetail>(`/tasks/${key}`),
    enabled: !!key,
    placeholderData: () => (key ? (findCachedTask(qc, key) as TaskDetail | undefined) : undefined),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TaskPatch & { projectId: string; title: string }) => api.post<Task>('/tasks', body),
    onSuccess: (task) => {
      qc.setQueryData(qk.task(task.key), task);
      invalidateTaskViews(qc, task.projectId);
    },
  });
}

/** Optimistic field update: the UI changes immediately and rolls back if the API rejects it. */
export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ task, patch }: { task: Task; patch: TaskPatch; optimistic?: Partial<Task> }) => api.patch<Task>(`/tasks/${task.id}`, patch),
    onMutate: async ({ task, patch, optimistic }) => {
      await qc.cancelQueries({ queryKey: ['board'] });
      const rollback = snapshotTaskCaches(qc);
      const { assigneeId: _ignored, ...fields } = patch;
      patchCachedTask(qc, task.id, (t) => ({ ...t, ...fields, ...optimistic }));
      return { rollback };
    },
    onError: (err, _vars, ctx) => {
      ctx?.rollback();
      toast.error(`Couldn't save changes. ${errorMessage(err)}`);
    },
    onSuccess: (task) => patchCachedTask(qc, task.id, () => task),
    onSettled: (_d, _e, { task }) => invalidateTaskViews(qc, task.projectId),
  });
}

/**
 * Drag & drop move. The board cache has already been updated optimistically by the
 * board while dragging; on failure we restore the snapshot taken at drag start.
 */
export function useMoveTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ task, stateId, position }: { task: Task; stateId: string; position: number; rollback: () => void }) =>
      api.patch<Task>(`/tasks/${task.id}/status`, { stateId, position }),
    onError: (_err, { rollback }) => {
      rollback();
      toast.error("Couldn't move task. Please try again.");
    },
    onSuccess: (task) => qc.setQueryData(qk.task(task.key), task),
    onSettled: (_d, _e, { task }) => invalidateTaskViews(qc, task.projectId),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (task: Task) => api.delete(`/tasks/${task.id}`),
    onMutate: (task) => {
      const rollback = snapshotTaskCaches(qc);
      removeCachedTask(qc, task.id);
      return { rollback };
    },
    onError: (err, _task, ctx) => {
      ctx?.rollback();
      toast.error(`Couldn't delete task. ${errorMessage(err)}`);
    },
    onSuccess: (_d, task) => toast.success(`${task.key} deleted`),
    onSettled: (_d, _e, task) => invalidateTaskViews(qc, task.projectId),
  });
}

export function useComments(taskKey: string) {
  return useQuery({ queryKey: qk.comments(taskKey), queryFn: () => api.get<Comment[]>(`/tasks/${taskKey}/comments`) });
}

export function useAddComment(taskKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.post<Comment>(`/tasks/${taskKey}/comments`, { body }),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: qk.comments(taskKey) });
      const prev = qc.getQueryData<Comment[]>(qk.comments(taskKey));
      const me = useSessionStore.getState().session!.user;
      const pending: Comment = { id: `pending-${Date.now()}`, taskId: '', body, author: me, createdAt: new Date().toISOString(), updatedAt: '', pending: true };
      qc.setQueryData<Comment[]>(qk.comments(taskKey), (c) => [...(c ?? []), pending]);
      return { prev };
    },
    onError: (err, _b, ctx) => {
      qc.setQueryData(qk.comments(taskKey), ctx?.prev);
      toast.error(`Couldn't post comment. ${errorMessage(err)}`);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.comments(taskKey) });
      qc.invalidateQueries({ queryKey: qk.taskActivity(taskKey) });
    },
  });
}

export function useAttachments(taskKey: string) {
  return useQuery({ queryKey: qk.attachments(taskKey), queryFn: () => api.get<Attachment[]>(`/tasks/${taskKey}/attachments`) });
}

/** Signed-URL upload: ask the API for a URL, PUT the bytes straight to storage, then record it. */
export function useUploadAttachment(taskKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const target = await api.post<{ uploadUrl: string; storageKey: string; headers: Record<string, string> }>(`/tasks/${taskKey}/attachments/upload-url`, {
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
      });
      const put = await fetch(target.uploadUrl, { method: 'PUT', headers: target.headers, body: file });
      if (!put.ok) throw new Error((await put.json().catch(() => null))?.error?.message ?? 'Upload failed');
      return api.post<Attachment>(`/tasks/${taskKey}/attachments`, { storageKey: target.storageKey, fileName: file.name, contentType: file.type || 'application/octet-stream' });
    },
    onSuccess: (a) => qc.setQueryData<Attachment[]>(qk.attachments(taskKey), (list) => [...(list ?? []).filter((x) => x.id !== a.id), a]),
    onError: (err) => toast.error(`Upload failed. ${errorMessage(err)}`),
  });
}

export function useDeleteAttachment(taskKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/attachments/${id}`),
    onSuccess: (_d, id) => qc.setQueryData<Attachment[]>(qk.attachments(taskKey), (list) => list?.filter((a) => a.id !== id)),
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useTaskActivity(taskKey: string) {
  return useQuery({ queryKey: qk.taskActivity(taskKey), queryFn: () => api.get<Activity[]>(`/tasks/${taskKey}/activity`) });
}

/* ─────────── Subtasks, labels, watchers, links ─────────── */

export function useSubtasks(taskKey: string) {
  return useQuery({ queryKey: qk.subtasks(taskKey), queryFn: () => api.get<Task[]>(`/tasks/${taskKey}/subtasks`) });
}

export function useLabels() {
  return useQuery({ queryKey: qk.labels, queryFn: () => api.get<Label[]>('/labels'), staleTime: 60_000 });
}

export function useCreateLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; color: string }) => api.post<Label>('/labels', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.labels }),
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useDeleteLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/labels/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.labels }),
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/** Watch / unwatch (self or someone else); updates the drawer's watcher list in place. */
export function useWatch(taskKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, on }: { userId?: string; on: boolean }) =>
      on ? api.post<UserSummary[]>(`/tasks/${taskKey}/watchers`, userId ? { userId } : {}) : api.delete<UserSummary[]>(`/tasks/${taskKey}/watchers/${userId}`),
    onSuccess: (watchers) => qc.setQueryData<TaskDetail>(qk.task(taskKey), (t) => (t ? { ...t, watchers } : t)),
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useLinkMutations(task: Task) {
  const qc = useQueryClient();
  const set = (links: TaskLinkItem[]) => {
    qc.setQueryData<TaskDetail>(qk.task(task.key), (t) => (t ? { ...t, links } : t));
    qc.invalidateQueries({ queryKey: qk.task(task.key) });
    invalidateTaskViews(qc, task.projectId);
  };
  return {
    add: useMutation({
      mutationFn: (body: { targetId: string; type: string; direction?: 'outgoing' | 'incoming' }) => api.post<TaskLinkItem[]>(`/tasks/${task.key}/links`, body),
      onSuccess: set,
      onError: (e) => toast.error(errorMessage(e)),
    }),
    remove: useMutation({
      mutationFn: (linkId: string) => api.delete<TaskLinkItem[]>(`/tasks/${task.key}/links/${linkId}`),
      onSuccess: set,
      onError: (e) => toast.error(errorMessage(e)),
    }),
  };
}

export function useBulkUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, patch }: { ids: string[]; patch: TaskPatch; projectId?: string }) => api.patch<{ updated: Task[]; failed: { id: string; message: string }[] }>('/tasks/bulk', { ids, patch }),
    onSuccess: (r) => {
      r.updated.forEach((t) => patchCachedTask(qc, t.id, () => t));
      if (r.failed.length) toast.error(`${r.failed.length} task(s) could not be updated`);
      else toast.success(`Updated ${r.updated.length} task(s)`);
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: (_d, _e, v) => invalidateTaskViews(qc, v.projectId),
  });
}

/* ─────────── Time tracking ─────────── */

export function useRunningTimer() {
  return useQuery({ queryKey: qk.timer, queryFn: () => api.get<TimeEntry | null>('/timer'), staleTime: 60_000 });
}

export function useTimeEntries(taskKey: string) {
  return useQuery({ queryKey: qk.timeEntries(taskKey), queryFn: () => api.get<TimeEntry[]>(`/tasks/${taskKey}/time-entries`) });
}

export function useTimer() {
  const qc = useQueryClient();
  const refresh = (e?: TimeEntry) => {
    qc.invalidateQueries({ queryKey: ['time'] });
    qc.invalidateQueries({ queryKey: qk.dashboard });
    if (e?.task) {
      qc.invalidateQueries({ queryKey: qk.task(e.task.key) });
      invalidateTaskViews(qc, e.task.projectId);
    }
  };
  return {
    start: useMutation({
      mutationFn: (taskKey: string) => api.post<TimeEntry>(`/tasks/${taskKey}/timer`),
      onSuccess: (e) => {
        qc.setQueryData(qk.timer, e);
        refresh();
        toast.info(`Timer started on ${e.task?.key}`);
      },
      onError: (e) => toast.error(errorMessage(e)),
    }),
    stop: useMutation({
      mutationFn: () => api.post<TimeEntry>('/timer/stop'),
      onSuccess: (e) => {
        qc.setQueryData(qk.timer, null);
        refresh(e);
        toast.success(`Logged ${e.minutes}m on ${e.task?.key}`);
      },
      onError: (e) => toast.error(errorMessage(e)),
    }),
    log: useMutation({
      mutationFn: ({ taskKey, minutes, note, date }: { taskKey: string; minutes: number; note?: string; date?: string }) => api.post<TimeEntry>(`/tasks/${taskKey}/time-entries`, { minutes, note, date }),
      onSuccess: (e) => {
        refresh(e);
        toast.success(`Logged ${e.minutes}m`);
      },
      onError: (e) => toast.error(errorMessage(e)),
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.delete(`/time-entries/${id}`),
      onSuccess: () => refresh(),
      onError: (e) => toast.error(errorMessage(e)),
    }),
  };
}

/* ─────────── Workflow ─────────── */

export function useWorkflow(projectId: string | undefined) {
  return useQuery({ queryKey: qk.workflow(projectId ?? ''), queryFn: () => api.get<WorkflowState[]>(`/projects/${projectId}/workflow`), enabled: !!projectId, staleTime: 60_000 });
}

export function useWorkflowMutations(projectId: string) {
  const qc = useQueryClient();
  const done = (states: WorkflowState[]) => {
    qc.setQueryData(qk.workflow(projectId), states);
    invalidateTaskViews(qc, projectId);
  };
  const opts = { onSuccess: done, onError: (e: unknown) => toast.error(errorMessage(e)) };
  return {
    create: useMutation({ mutationFn: (b: { name: string; category: string; color?: string; wipLimit?: number | null; position?: number }) => api.post<WorkflowState[]>(`/projects/${projectId}/workflow/states`, b), ...opts }),
    update: useMutation({ mutationFn: ({ id, ...b }: { id: string; name?: string; category?: string; color?: string; wipLimit?: number | null }) => api.patch<WorkflowState[]>(`/workflow-states/${id}`, b), ...opts }),
    reorder: useMutation({
      mutationFn: (stateIds: string[]) => api.patch<WorkflowState[]>(`/projects/${projectId}/workflow/order`, { stateIds }),
      onMutate: (ids: string[]) => {
        const prev = qc.getQueryData<WorkflowState[]>(qk.workflow(projectId));
        if (prev) qc.setQueryData(qk.workflow(projectId), ids.map((id, i) => ({ ...prev.find((s) => s.id === id)!, position: i })));
        return { prev };
      },
      onSuccess: done,
      onError: (e: unknown, _ids: string[], ctx?: { prev?: WorkflowState[] }) => {
        if (ctx?.prev) qc.setQueryData(qk.workflow(projectId), ctx.prev);
        toast.error(errorMessage(e));
      },
    }),
    remove: useMutation({ mutationFn: ({ id, moveTo }: { id: string; moveTo?: string }) => api.delete<WorkflowState[]>(`/workflow-states/${id}${moveTo ? `?moveTo=${moveTo}` : ''}`), ...opts }),
  };
}
