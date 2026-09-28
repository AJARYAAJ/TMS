import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/toast';
import { api, errorMessage } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import { useSessionStore } from '@/features/auth/session.store';
import type { Activity, Attachment, Board, Comment, Task, TaskPriority, TaskStatus, TaskType } from '@/types';
import { findCachedTask, invalidateTaskViews, patchCachedTask, removeCachedTask, snapshotTaskCaches } from './cache';

export interface TaskFilters {
  projectId?: string;
  status?: string;
  assigneeId?: string;
  sprintId?: string;
  type?: TaskType;
  priority?: TaskPriority;
  q?: string;
  open?: 'true' | 'false';
  dueFrom?: string;
  dueTo?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  size?: number;
}

export type TaskPatch = Partial<Pick<Task, 'title' | 'description' | 'type' | 'status' | 'priority' | 'sprintId' | 'storyPoints' | 'startDate' | 'dueDate'>> & {
  assigneeId?: string | null;
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
    queryFn: () => api.get<Task>(`/tasks/${key}`),
    enabled: !!key,
    placeholderData: () => (key ? findCachedTask(qc, key) : undefined),
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
    mutationFn: ({ task, status, position }: { task: Task; status: TaskStatus; position: number; rollback: () => void }) =>
      api.patch<Task>(`/tasks/${task.id}/status`, { status, position }),
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
