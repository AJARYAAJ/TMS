import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/components/ui/toast';
import { api, errorMessage } from '@/services/api/client';
import type { MfaChallenge, Session } from '@/types';
import { detachDesktop } from '@/features/notifications/desktop';
import { useSessionStore } from './session.store';

/** Password sign-in. Resolves to a session, or to a 2FA challenge when the account has 2FA on. */
export function useLogin() {
  const setSession = useSessionStore((s) => s.setSession);
  return useMutation({
    mutationFn: (body: { email: string; password: string }) => api.post<Session | MfaChallenge>('/auth/login', body),
    onSuccess: (r) => {
      if ('token' in r) setSession(r);
    },
  });
}

export function useSecondFactor() {
  const setSession = useSessionStore((s) => s.setSession);
  return useMutation({
    mutationFn: (body: { mfaToken: string; code: string }) => api.post<Session>('/auth/login/2fa', body),
    onSuccess: setSession,
  });
}

/** Re-reads /auth/me (e.g. after turning on 2FA) and refreshes the stored session. */
export async function refreshSession() {
  const me = await api.get<Omit<Session, 'token'>>('/auth/me');
  useSessionStore.getState().update(me);
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
    // Stop this browser's desktop notifications for this person; the next sign-in re-registers it.
    void detachDesktop(useSessionStore.getState().session?.token);
    signOut();
    qc.clear();
  };
}
