import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { Activity, Project, UserSummary, Role } from '@/types';

export function useProjects() {
  return useQuery({ queryKey: qk.projects, queryFn: () => api.get<Project[]>('/projects') });
}

/** Accepts key or id; uses the cached project list for an instant first paint. */
export function useProject(idOrKey: string | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.project(idOrKey ?? ''),
    queryFn: () => api.get<Project>(`/projects/${idOrKey}`),
    enabled: !!idOrKey,
    placeholderData: () => qc.getQueryData<Project[]>(qk.projects)?.find((p) => p.key === idOrKey?.toUpperCase() || p.id === idOrKey),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; key?: string; description?: string; color?: string }) => api.post<Project>('/projects', body),
    onSuccess: (p) => {
      qc.setQueryData<Project[]>(qk.projects, (list) => [...(list ?? []), p].sort((a, b) => a.name.localeCompare(b.name)));
      qc.setQueryData(qk.project(p.key), p);
    },
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; description?: string; color?: string; status?: string }) => api.patch<Project>(`/projects/${id}`, body),
    onSuccess: (p) => {
      qc.setQueryData(qk.project(p.key), p);
      qc.invalidateQueries({ queryKey: qk.projects });
    },
  });
}

export function useProjectActivity(projectId: string | undefined) {
  return useQuery({ queryKey: qk.projectActivity(projectId ?? ''), queryFn: () => api.get<Activity[]>(`/projects/${projectId}/activity`, { limit: 20 }), enabled: !!projectId });
}

/** Organization members (for assignee pickers). Cached for 5 minutes. */
export function useUsers() {
  return useQuery({ queryKey: qk.users, queryFn: () => api.get<(UserSummary & { role: Role })[]>('/users'), staleTime: 5 * 60_000 });
}
