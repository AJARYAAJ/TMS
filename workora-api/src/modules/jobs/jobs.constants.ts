export const JOBS_QUEUE = 'workora-jobs';

export const JobNames = {
  PROJECT_SETUP: 'project.setup',
  NOTIFICATION_EMAIL: 'notification.email',
  OVERDUE_SCAN: 'tasks.overdue-scan',
} as const;

export interface ProjectSetupJob {
  organizationId: string;
  projectId: string;
}

export function redisConnection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}
