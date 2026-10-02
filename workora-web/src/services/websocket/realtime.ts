import type { QueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { config } from '@/config';
import { toast } from '@/components/ui/toast';
import { notificationPath, showFromTab } from '@/features/notifications/desktop';
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

  connect(token: string, qc: QueryClient, selfId: string, openNotification: (n: Notification) => void) {
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
      applyToCache(qc, e, selfId, openNotification);
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

function applyToCache(qc: QueryClient, e: RealtimeEvent, selfId: string, openNotification: (n: Notification) => void) {
  const fromSelf = e.actor?.id === selfId;
  switch (e.type) {
    case 'TASK_CREATED':
    case 'TASK_UPDATED':
    case 'TASK_ASSIGNED': {
      const task: Task = e.data.task;
      patchCachedTask(qc, task.id, () => task);
      if (task.parentId) qc.invalidateQueries({ queryKey: ['subtasks'] });
      // Ordering of neighbours may have changed: refetch boards/lists in the background.
      if (!fromSelf) invalidateTaskViews(qc, task.projectId);
      qc.invalidateQueries({ queryKey: qk.taskActivity(task.key) });
      break;
    }
    case 'TASK_DELETED': {
      const task: Task = e.data.task;
      removeCachedTask(qc, task.id);
      qc.removeQueries({ queryKey: qk.task(task.key) });
      qc.invalidateQueries({ queryKey: qk.trash });
      if (!fromSelf) invalidateTaskViews(qc, task.projectId);
      break;
    }
    case 'TASK_LINKED':
    case 'TIME_LOGGED':
      qc.invalidateQueries({ queryKey: qk.task(e.data.task.key) });
      qc.invalidateQueries({ queryKey: ['time'] });
      if (e.projectId) invalidateTaskViews(qc, e.projectId);
      break;
    case 'DOCUMENT_CREATED':
    case 'DOCUMENT_UPDATED':
    case 'DOCUMENT_DELETED':
      qc.invalidateQueries({ queryKey: ['documents'] });
      if (!fromSelf) qc.invalidateQueries({ queryKey: qk.document(e.data.document.id) });
      break;
    case 'GOAL_CREATED':
    case 'GOAL_UPDATED':
      qc.invalidateQueries({ queryKey: qk.goals });
      break;
    case 'DEV_LINKED':
      qc.invalidateQueries({ queryKey: qk.task(e.data.task.key) });
      qc.invalidateQueries({ queryKey: qk.taskActivity(e.data.task.key) });
      if (e.projectId) invalidateTaskViews(qc, e.projectId);
      break;
    case 'FIELDS_UPDATED':
      if (e.projectId) {
        qc.setQueryData(qk.fields(e.projectId), e.data.fields);
        invalidateTaskViews(qc, e.projectId);
      }
      break;
    case 'VIEWS_UPDATED':
      if (e.projectId) qc.invalidateQueries({ queryKey: qk.views(e.projectId) });
      break;
    case 'TASK_RESTORED':
    case 'TASKS_IMPORTED':
      qc.invalidateQueries({ queryKey: qk.trash });
      if (e.projectId) invalidateTaskViews(qc, e.projectId);
      qc.invalidateQueries({ queryKey: qk.labels });
      break;
    case 'WORKFLOW_UPDATED':
      if (e.projectId) {
        qc.setQueryData(qk.workflow(e.projectId), e.data.states);
        invalidateTaskViews(qc, e.projectId);
      }
      break;
    case 'TASK_RECURRED':
      toast.info(`${e.data.task.key} repeats — ${e.data.next.key} is due ${e.data.next.dueDate ?? 'soon'}`);
      if (e.projectId) invalidateTaskViews(qc, e.projectId);
      break;
    case 'AUTOMATION_RAN':
      if (e.projectId) qc.invalidateQueries({ queryKey: qk.automations(e.projectId) });
      qc.invalidateQueries({ queryKey: qk.comments(e.data.task.key) });
      break;
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
      toast.info(n.title, { label: 'Open', onClick: () => openNotification(n) });
      // In another tab or app: a desktop notification, when this browser has no push subscription.
      void showFromTab(n, `${import.meta.env.BASE_URL.replace(/\/$/, '')}${notificationPath(n)}`);
      break;
    }
  }
}
