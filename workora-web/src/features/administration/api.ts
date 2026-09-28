import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/toast';
import { api, errorMessage } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { Member, Role, Team } from '@/types';

export const useMembers = () => useQuery({ queryKey: qk.members, queryFn: () => api.get<Member[]>('/organizations/current/members') });
export const useTeams = () => useQuery({ queryKey: qk.teams, queryFn: () => api.get<Team[]>('/teams') });

function useInvalidate(...keys: readonly (readonly unknown[])[]) {
  const qc = useQueryClient();
  return () => keys.forEach((queryKey) => qc.invalidateQueries({ queryKey }));
}

export function useAddMember() {
  const invalidate = useInvalidate(qk.members, qk.users);
  return useMutation({
    mutationFn: (body: { email: string; role: Role; name?: string; password?: string }) => api.post<Member>('/organizations/current/members', body),
    onSuccess: (m) => {
      toast.success(`${m.user.name} added`);
      invalidate();
    },
  });
}

export function useUpdateMember() {
  const invalidate = useInvalidate(qk.members, qk.users);
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) => api.patch<Member>(`/organizations/current/members/${userId}`, { role }),
    onSuccess: invalidate,
    onError: (e) => {
      toast.error(errorMessage(e));
      invalidate();
    },
  });
}

export function useRemoveMember() {
  const invalidate = useInvalidate(qk.members, qk.users);
  return useMutation({
    mutationFn: (userId: string) => api.delete(`/organizations/current/members/${userId}`),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useTeamMutations() {
  const invalidate = useInvalidate(qk.teams);
  const opts = { onSuccess: invalidate, onError: (e: unknown) => toast.error(errorMessage(e)) };
  return {
    create: useMutation({ mutationFn: (body: { name: string; description?: string }) => api.post<Team>('/teams', body), ...opts }),
    remove: useMutation({ mutationFn: (id: string) => api.delete(`/teams/${id}`), ...opts }),
    addMember: useMutation({ mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) => api.post(`/teams/${teamId}/members`, { userId }), ...opts }),
    removeMember: useMutation({ mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) => api.delete(`/teams/${teamId}/members/${userId}`), ...opts }),
  };
}
