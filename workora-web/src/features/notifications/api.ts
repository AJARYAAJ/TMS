import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Envelope } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { Notification } from '@/types';

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
