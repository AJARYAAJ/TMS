import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/features/auth/session.store';
import { useOpenTask } from '@/features/tasks/useOpenTask';
import { realtime } from './realtime';

/** Keeps the socket connected for the signed-in session. */
export function useRealtimeConnection() {
  const session = useSession();
  const qc = useQueryClient();
  const openTask = useOpenTask();
  // The socket outlives renders; always open tasks relative to the *current* location.
  const openTaskRef = useRef(openTask);
  openTaskRef.current = openTask;
  useEffect(() => {
    if (!session) return;
    realtime.connect(session.token, qc, session.user.id, (key) => openTaskRef.current(key));
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
