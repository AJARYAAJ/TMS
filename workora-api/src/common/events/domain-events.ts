import { Actor } from '../auth/principal';

/**
 * Common event model. Services publish a DomainEvent *after* their transaction commits;
 * independent subscribers (activity log, notifications, realtime gateway, background jobs,
 * analytics…) react to it. The Task API never calls those subsystems directly.
 */
export const DOMAIN_EVENT = 'workora.domain-event';

export type DomainEventType =
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TASK_ASSIGNED'
  | 'TASK_DELETED'
  | 'COMMENT_CREATED'
  | 'ATTACHMENT_ADDED'
  | 'ATTACHMENT_DELETED'
  | 'PROJECT_CREATED'
  | 'PROJECT_UPDATED'
  | 'SPRINT_CREATED'
  | 'SPRINT_UPDATED'
  | 'SPRINT_STARTED'
  | 'SPRINT_COMPLETED'
  | 'USER_ADDED'
  | 'TASK_OVERDUE'
  | 'TASK_LINKED'
  | 'TIME_LOGGED'
  | 'DOCUMENT_CREATED'
  | 'DOCUMENT_UPDATED'
  | 'DOCUMENT_DELETED'
  | 'GOAL_CREATED'
  | 'GOAL_UPDATED'
  | 'AUTOMATION_RAN'
  | 'WORKFLOW_UPDATED'
  | 'TASK_RECURRED';

export interface FieldChange {
  from: unknown;
  to: unknown;
}

export interface DomainEvent<T = any> {
  id: string;
  type: DomainEventType;
  organizationId: string;
  projectId?: string;
  actor: Actor | null;
  occurredAt: string;
  data: T;
}
