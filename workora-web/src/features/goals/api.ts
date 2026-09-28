import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/toast';
import { api, errorMessage } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { Goal } from '@/types';

export const useGoals = (projectId?: string) =>
  useQuery({ queryKey: projectId ? [...qk.goals, projectId] : qk.goals, queryFn: () => api.get<Goal[]>('/goals', projectId ? { projectId } : undefined) });

/** All goal mutations return the fresh goal; patch it into every cached goal list. */
export function useGoalMutations() {
  const qc = useQueryClient();
  const put = (g: Goal) => {
    qc.setQueriesData<Goal[]>({ queryKey: qk.goals }, (list) => (list ? (list.some((x) => x.id === g.id) ? list.map((x) => (x.id === g.id ? g : x)) : [g, ...list]) : list));
  };
  const opts = { onSuccess: put, onError: (e: unknown) => toast.error(errorMessage(e)) };
  return {
    create: useMutation({ mutationFn: (b: { title: string; description?: string; projectId?: string | null; dueDate?: string | null }) => api.post<Goal>('/goals', b), ...opts }),
    update: useMutation({ mutationFn: ({ id, ...b }: { id: string } & Partial<Pick<Goal, 'title' | 'description' | 'status' | 'dueDate'>>) => api.patch<Goal>(`/goals/${id}`, b), ...opts }),
    remove: useMutation({
      mutationFn: (id: string) => api.delete(`/goals/${id}`),
      onSuccess: (_d: unknown, id: string) => qc.setQueriesData<Goal[]>({ queryKey: qk.goals }, (l) => l?.filter((g) => g.id !== id)),
      onError: (e: unknown) => toast.error(errorMessage(e)),
    }),
    addKr: useMutation({ mutationFn: ({ goalId, ...b }: { goalId: string; title: string; kind?: string; startValue?: number; targetValue?: number; unit?: string }) => api.post<Goal>(`/goals/${goalId}/key-results`, b), ...opts }),
    updateKr: useMutation({ mutationFn: ({ goalId, krId, ...b }: { goalId: string; krId: string; currentValue?: number }) => api.patch<Goal>(`/goals/${goalId}/key-results/${krId}`, b), ...opts }),
    removeKr: useMutation({ mutationFn: ({ goalId, krId }: { goalId: string; krId: string }) => api.delete<Goal>(`/goals/${goalId}/key-results/${krId}`), ...opts }),
    linkTask: useMutation({ mutationFn: ({ goalId, taskId }: { goalId: string; taskId: string }) => api.post<Goal>(`/goals/${goalId}/tasks`, { taskId }), ...opts }),
    unlinkTask: useMutation({ mutationFn: ({ goalId, taskId }: { goalId: string; taskId: string }) => api.delete<Goal>(`/goals/${goalId}/tasks/${taskId}`), ...opts }),
  };
}
