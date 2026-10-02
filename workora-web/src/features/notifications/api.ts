import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/components/ui/toast';
import { useOpenTask } from '@/features/tasks/useOpenTask';
import { api, Envelope, errorMessage } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { Notification, PushConfig } from '@/types';
import { notificationPath } from './desktop';

export function useNotifications() {
  return useQuery({ queryKey: qk.notifications, queryFn: () => api.raw<Notification[]>('GET', '/notifications', { query: { size: 30 } }) });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | 'all') => (id === 'all' ? api.post('/notifications/read-all') : api.post(`/notifications/${id}/read`)),
    onMutate: (id) => {
      qc.setQueryData<Envelope<Notification[]>>(qk.notifications, (env) => {
        if (!env) return env;
        const data = env.data.map((n) => (id === 'all' || n.id === id ? { ...n, read: true } : n));
        return { data, meta: { ...env.meta, unreadCount: id === 'all' ? 0 : Math.max(0, (env.meta.unreadCount ?? 1) - (env.data.find((n) => n.id === id && !n.read) ? 1 : 0)) } };
      });
    },
    onError: () => qc.invalidateQueries({ queryKey: qk.notifications }),
  });
}

/** Opens what a notification is about: tasks in the drawer over the current page, anything else by route. */
export function useOpenNotification() {
  const openTask = useOpenTask();
  const navigate = useNavigate();
  const markRead = useMarkRead();
  return useCallback(
    (n: Notification) => {
      if (!n.read) markRead.mutate(n.id);
      if (n.taskKey && !n.link) openTask(n.taskKey);
      else navigate(notificationPath(n));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openTask, navigate],
  );
}

export const PUSH_KEY = ['push-config'] as const;

export function usePushConfig() {
  return useQuery({ queryKey: PUSH_KEY, queryFn: () => api.get<PushConfig>('/notifications/push') });
}

export function useUpdatePushPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { enabled?: boolean; categories?: Record<string, boolean> }) => api.patch<PushConfig>('/notifications/push', patch),
    onMutate: (patch) =>
      qc.setQueryData<PushConfig>(PUSH_KEY, (c) => (c ? { ...c, enabled: patch.enabled ?? c.enabled, categories: { ...c.categories, ...patch.categories } } : c)),
    onSuccess: (c) => qc.setQueryData(PUSH_KEY, c),
    onError: (e) => {
      toast.error(errorMessage(e));
      qc.invalidateQueries({ queryKey: PUSH_KEY });
    },
  });
}
