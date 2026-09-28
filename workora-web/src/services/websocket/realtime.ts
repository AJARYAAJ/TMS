import type { QueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { config } from '@/config';
import { toast } from '@/components/ui/toast';
import { invalidateTaskViews, patchCachedTask, removeCachedTask } from '@/features/tasks/cache';
import type { Envelope } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { Notification, RealtimeEvent, Task } from '@/types';

type Listener = (e: RealtimeEvent) => void;
type Status = 'connecting' | 'online' | 'offline';

/**
 * Realtime client: one socket per session. Events from the gateway are applied straight
 * to the query cache so every open view (board, list, drawer, dashboard) updates live.
 */
class RealtimeClient {
  private socket: Socket | null = null;
  private projects = new Set<string>();
  private listeners = new Set<Listener>();
  private statusListeners = new Set<(s: Status) => void>();
  status: Status = 'offline';

  connect(token: string, qc: QueryClient, selfId: string, openTask: (key: string) => void) {
    this.disconnect();
    const socket = io({ path: config.realtimePath, auth: { token }, transports: ['websocket'], reconnectionDelayMax: 10_000 });
    this.socket = socket;
    this.setStatus('connecting');
    socket.on('ready', () => {
      this.setStatus('online');
      this.projects.forEach((projectId) => socket.emit('subscribe', { projectId }));
    });
    socket.on('disconnect', () => this.setStatus('offline'));
    socket.io.on('reconnect_attempt', () => this.setStatus('connecting'));
    socket.io.on('reconnect', () => {
      // We may have missed events while offline: revalidate everything in the background.
      qc.invalidateQueries();
    });
    socket.on('event', (e: RealtimeEvent) => {
      applyToCache(qc, e, selfId, openTask);
      this.listeners.forEach((l) => l(e));
    });
  }

  disconnect() {
    this.socket?.removeAllListeners();
    this.socket?.io.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.setStatus('offline');
  }

  watchProject(projectId: string) {
    this.projects.add(projectId);
    this.socket?.emit('subscribe', { projectId });
    return () => {
      this.projects.delete(projectId);
      this.socket?.emit('unsubscribe', { projectId });
    };
  }

  onEvent(l: Listener) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  onStatus(l: (s: Status) => void) {
    this.statusListeners.add(l);
    return () => void this.statusListeners.delete(l);
  }

  private setStatus(s: Status) {
    this.status = s;
    this.statusListeners.forEach((l) => l(s));
  }
}

export const realtime = new RealtimeClient();

function applyToCache(qc: QueryClient, e: RealtimeEvent, selfId: string, openTask: (key: string) => void) {
  const fromSelf = e.actor?.id === selfId;
  switch (e.type) {
    case 'TASK_CREATED':
    case 'TASK_UPDATED':
    case 'TASK_ASSIGNED': {
      const task: Task = e.data.task;
      qc.setQueryData(qk.task(task.key), task);
      patchCachedTask(qc, task.id, () => task);
      // Ordering of neighbours may have changed: refetch boards/lists in the background.
      if (!fromSelf) invalidateTaskViews(qc, task.projectId);
      qc.invalidateQueries({ queryKey: qk.taskActivity(task.key) });
      break;
    }
    case 'TASK_DELETED': {
      const task: Task = e.data.task;
      removeCachedTask(qc, task.id);
      qc.removeQueries({ queryKey: qk.task(task.key) });
      if (!fromSelf) invalidateTaskViews(qc, task.projectId);
      break;
    }
    case 'COMMENT_CREATED':
      qc.invalidateQueries({ queryKey: qk.comments(e.data.task.key) });
      qc.invalidateQueries({ queryKey: qk.taskActivity(e.data.task.key) });
      break;
    case 'ATTACHMENT_ADDED':
    case 'ATTACHMENT_DELETED':
      qc.invalidateQueries({ queryKey: qk.attachments(e.data.task.key) });
      qc.invalidateQueries({ queryKey: qk.taskActivity(e.data.task.key) });
      break;
    case 'SPRINT_CREATED':
    case 'SPRINT_UPDATED':
    case 'SPRINT_STARTED':
    case 'SPRINT_COMPLETED':
      if (e.projectId) invalidateTaskViews(qc, e.projectId);
      break;
    case 'PROJECT_CREATED':
    case 'PROJECT_UPDATED':
      qc.invalidateQueries({ queryKey: qk.projects });
      qc.invalidateQueries({ queryKey: ['project'] });
      break;
    case 'USER_ADDED':
      qc.invalidateQueries({ queryKey: qk.members });
      qc.invalidateQueries({ queryKey: qk.users });
      break;
    case 'NOTIFICATION_CREATED': {
      const n: Notification = e.data;
      qc.setQueryData<Envelope<Notification[]>>(qk.notifications, (env) =>
        env ? { data: [n, ...env.data.filter((x) => x.id !== n.id)], meta: { ...env.meta, unreadCount: (env.meta.unreadCount ?? 0) + 1 } } : env,
      );
      if (!qc.getQueryData(qk.notifications)) qc.invalidateQueries({ queryKey: qk.notifications });
      toast.info(n.title, n.taskKey ? { label: 'Open', onClick: () => openTask(n.taskKey!) } : undefined);
      break;
    }
  }
}
