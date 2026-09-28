import type { QueryClient } from '@tanstack/react-query';
import type { Envelope } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { Board, Task } from '@/types';

/** Finds a task in any cached board or list so the drawer can render instantly. */
export function findCachedTask(qc: QueryClient, key: string): Task | undefined {
  const upper = key.toUpperCase();
  const direct = qc.getQueryData<Task>(qk.task(upper));
  if (direct) return direct;
  for (const [, board] of qc.getQueriesData<Board>({ queryKey: ['board'] })) {
    for (const col of board?.columns ?? []) {
      const t = col.tasks.find((x) => x.key === upper || x.id === key);
      if (t) return t;
    }
  }
  for (const [, list] of qc.getQueriesData<Envelope<Task[]>>({ queryKey: qk.allTasks })) {
    const t = list?.data?.find((x) => x.key === upper || x.id === key);
    if (t) return t;
  }
  return undefined;
}

/** Applies `update` to a task wherever it is cached (detail, boards, lists). */
export function patchCachedTask(qc: QueryClient, id: string, update: (t: Task) => Task) {
  qc.setQueriesData<Task>({ queryKey: ['task'] }, (t) => (t && t.id === id ? update(t) : t));
  qc.setQueriesData<Board>({ queryKey: ['board'] }, (b) =>
    b ? { ...b, columns: b.columns.map((c) => ({ ...c, tasks: c.tasks.map((t) => (t.id === id ? update(t) : t)) })) } : b,
  );
  qc.setQueriesData<Envelope<Task[]>>({ queryKey: qk.allTasks }, (l) => (l?.data ? { ...l, data: l.data.map((t) => (t.id === id ? update(t) : t)) } : l));
}

export function removeCachedTask(qc: QueryClient, id: string) {
  qc.setQueriesData<Board>({ queryKey: ['board'] }, (b) => (b ? { ...b, columns: b.columns.map((c) => ({ ...c, tasks: c.tasks.filter((t) => t.id !== id) })) } : b));
  qc.setQueriesData<Envelope<Task[]>>({ queryKey: qk.allTasks }, (l) => (l?.data ? { ...l, data: l.data.filter((t) => t.id !== id) } : l));
}

/** Snapshot of every cache a task mutation may touch, for rollback. */
export function snapshotTaskCaches(qc: QueryClient) {
  const entries = [...qc.getQueriesData({ queryKey: ['task'] }), ...qc.getQueriesData({ queryKey: ['board'] }), ...qc.getQueriesData({ queryKey: qk.allTasks })];
  return () => entries.forEach(([key, data]) => qc.setQueryData(key, data));
}

/** Refresh derived views after a task change (runs in the background; cached UI stays visible). */
export function invalidateTaskViews(qc: QueryClient, projectId?: string) {
  if (projectId) {
    qc.invalidateQueries({ queryKey: qk.board(projectId) });
    qc.invalidateQueries({ queryKey: qk.sprints(projectId) });
    qc.invalidateQueries({ queryKey: qk.reports(projectId) });
    qc.invalidateQueries({ queryKey: qk.projectActivity(projectId) });
  }
  qc.invalidateQueries({ queryKey: qk.allTasks });
  qc.invalidateQueries({ queryKey: qk.dashboard });
  qc.invalidateQueries({ queryKey: qk.projects });
}
