import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/features/auth/session.store';
import { useOpenNotification } from '@/features/notifications/api';
import { realtime } from './realtime';

/** Keeps the socket connected for the signed-in session. */
export function useRealtimeConnection() {
  const session = useSession();
  const qc = useQueryClient();
  const openNotification = useOpenNotification();
  // The socket outlives renders; always open relative to the *current* location.
  const openRef = useRef(openNotification);
  openRef.current = openNotification;
  useEffect(() => {
    if (!session) return;
    realtime.connect(session.token, qc, session.user.id, (n) => openRef.current(n));
    return () => realtime.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, qc]);
}

/** Subscribe to live events for the project currently on screen. */
export function useWatchProject(projectId: string | undefined) {
  useEffect(() => (projectId ? realtime.watchProject(projectId) : undefined), [projectId]);
}

export function useRealtimeStatus() {
  const [status, setStatus] = useState(realtime.status);
  useEffect(() => realtime.onStatus(setStatus), []);
  return status;
}
