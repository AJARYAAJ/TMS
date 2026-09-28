import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/toast';
import { api, errorMessage } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import { invalidateTaskViews } from '@/features/tasks/cache';
import type { Sprint } from '@/types';

export function useSprints(projectId: string | undefined) {
  return useQuery({ queryKey: qk.sprints(projectId ?? ''), queryFn: () => api.get<Sprint[]>(`/projects/${projectId}/sprints`), enabled: !!projectId });
}

export function useSprintAction(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'start' | 'complete' }) => api.post<Sprint & { movedToBacklog?: number }>(`/sprints/${id}/${action}`),
    onSuccess: (s, { action }) => {
      toast.success(action === 'start' ? `${s.name} started` : `${s.name} completed${s.movedToBacklog ? ` — ${s.movedToBacklog} unfinished task(s) moved to backlog` : ''}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => invalidateTaskViews(qc, projectId),
  });
}

export function useCreateSprint(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; goal?: string; startDate?: string; endDate?: string }) => api.post<Sprint>(`/projects/${projectId}/sprints`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sprints(projectId) }),
    onError: (err) => toast.error(errorMessage(err)),
  });
}
