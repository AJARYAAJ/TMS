import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/components/ui/toast';
import { api, errorMessage } from '@/services/api/client';
import type { Session } from '@/types';
import { useSessionStore } from './session.store';

export function useLogin() {
  const setSession = useSessionStore((s) => s.setSession);
  return useMutation({
    mutationFn: (body: { email: string; password: string }) => api.post<Session>('/auth/login', body),
    onSuccess: setSession,
  });
}

export function useRegister() {
  const setSession = useSessionStore((s) => s.setSession);
  return useMutation({
    mutationFn: (body: { name: string; email: string; password: string; organizationName: string }) => api.post<Session>('/auth/register', body),
    onSuccess: setSession,
  });
}

/** Switch workspace: new token, then drop every cached query from the old tenant. */
export function useSwitchOrganization() {
  const setSession = useSessionStore((s) => s.setSession);
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (organizationId: string) => api.post<Session>('/auth/switch-organization', { organizationId }),
    onSuccess: (session) => {
      qc.clear();
      setSession(session);
      navigate('/');
      toast.success(`Switched to ${session.organization.name}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useSignOut() {
  const signOut = useSessionStore((s) => s.signOut);
  const qc = useQueryClient();
  return () => {
    signOut();
    qc.clear();
  };
}
