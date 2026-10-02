import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from '@/components/ui/toast';
import { useSession, useSessionStore } from '@/features/auth/session.store';
import { api, errorMessage } from '@/services/api/client';
import type { Session } from '@/types';
import { useNotifications } from './api';
import { listenForClicks, syncDesktop } from './desktop';

/** App-wide notification plumbing; mounted once by the app shell. */
export function useNotificationEffects() {
  const session = useSession();
  const navigate = useNavigate();
  const { data } = useNotifications();
  const unread = data?.meta.unreadCount ?? 0;

  // "(3) Workora" in the tab strip.
  useEffect(() => {
    document.title = unread ? `(${unread > 99 ? '99+' : unread}) Workora` : 'Workora';
    return () => {
      document.title = 'Workora';
    };
  }, [unread]);

  // This browser's push subscription follows whoever is signed in.
  useEffect(() => {
    if (session?.token) void syncDesktop();
  }, [session?.token]);

  // Clicking a desktop notification while a tab is open navigates in place.
  useEffect(() => listenForClicks((path) => navigate(path)), [navigate]);

  useSwitchFromUrl();
}

/** Desktop notifications from another workspace carry ?org=<id>: switch to it, then show the page. */
function useSwitchFromUrl() {
  const [params, setParams] = useSearchParams();
  const session = useSession();
  const setSession = useSessionStore((s) => s.setSession);
  const qc = useQueryClient();
  const org = params.get('org');

  useEffect(() => {
    if (!org || !session) return;
    const drop = () =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('org');
          return next;
        },
        { replace: true },
      );
    if (org === session.organization.id || !session.organizations.some((o) => o.id === org)) return drop();
    api
      .post<Session>('/auth/switch-organization', { organizationId: org })
      .then((next) => {
        qc.clear();
        setSession(next);
        toast.success(`Switched to ${next.organization.name}`);
      })
      .catch((e) => toast.error(errorMessage(e)))
      .finally(drop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org]);
}
