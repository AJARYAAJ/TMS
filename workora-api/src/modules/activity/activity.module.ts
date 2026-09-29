import { Controller, Get, Injectable, Logger, Module, Param, Query } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { CurrentUser } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { DOMAIN_EVENT, DomainEvent } from '../../common/events/domain-events';
import { findProject } from '../projects/projects.service';
import { findTask } from '../tasks/tasks.service';
import { Activity } from './activity.entity';

const label = (s: unknown) => String(s ?? 'none').replace(/_/g, ' ').toLowerCase();
const formatMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

/** Turns a domain event into a human-readable activity entry (null = not worth logging). */
export function describe(e: DomainEvent): { summary: string; taskId?: string } | null {
  const d = e.data;
  switch (e.type) {
    case 'TASK_CREATED':
      return { summary: `created ${d.task.key} “${d.task.title}”`, taskId: d.task.id };
    case 'TASK_UPDATED': {
      const fields = Object.keys(d.changes).filter((f) => f !== 'position');
      if (!fields.length) return null; // pure re-order within a column
      if (d.changes.state) {
        return { summary: `moved ${d.task.key} from ${d.changes.state.from} to ${d.changes.state.to}`, taskId: d.task.id };
      }
      if (d.changes.status) {
        return { summary: `moved ${d.task.key} from ${label(d.changes.status.from)} to ${label(d.changes.status.to)}`, taskId: d.task.id };
      }
      const names = fields.flatMap((f) => (f === 'customFields' ? Object.keys(d.changes.customFields.to) : [label(f.replace(/Id$/, ''))]));
      return { summary: `updated ${names.join(', ')} on ${d.task.key}`, taskId: d.task.id };
    }
    case 'TASK_ASSIGNED':
      return { summary: `assigned ${d.task.key} to ${d.task.assignee?.name ?? 'nobody'}`, taskId: d.task.id };
    case 'TASK_DELETED':
      return { summary: `${d.trashed ? 'moved' : 'deleted'} ${d.task.key} “${d.task.title}”${d.trashed ? ' to the trash' : ''}` };
    case 'COMMENT_CREATED':
      return { summary: `commented on ${d.task.key}`, taskId: d.task.id };
    case 'ATTACHMENT_ADDED':
      return { summary: `attached ${d.attachment.fileName} to ${d.task.key}`, taskId: d.task.id };
    case 'ATTACHMENT_DELETED':
      return { summary: `removed an attachment from ${d.task.key}`, taskId: d.task.id };
    case 'PROJECT_CREATED':
      return { summary: `created project ${d.name}` };
    case 'PROJECT_UPDATED':
      return { summary: `updated project ${d.project.name}` };
    case 'SPRINT_CREATED':
      return { summary: `created ${d.sprint.name}` };
    case 'SPRINT_STARTED':
      return { summary: `started ${d.sprint.name}` };
    case 'SPRINT_COMPLETED':
      return { summary: `completed ${d.sprint.name}${d.movedToBacklog ? ` (${d.movedToBacklog} unfinished moved to backlog)` : ''}` };
    case 'USER_ADDED':
      return { summary: `added ${d.user.name} as ${label(d.role)}` };
    case 'TASK_OVERDUE':
      return { summary: `${d.task.key} became overdue`, taskId: d.task.id };
    case 'TASK_LINKED':
      return { summary: `linked ${d.link.source} ${label(d.link.type)} ${d.link.target}`, taskId: d.task.id };
    case 'TIME_LOGGED':
      return { summary: `logged ${formatMinutes(d.entry.minutes)} on ${d.task.key}`, taskId: d.task.id };
    case 'DOCUMENT_CREATED':
      return { summary: `created doc “${d.document.title}”` };
    case 'DOCUMENT_DELETED':
      return { summary: `deleted doc “${d.document.title}”` };
    case 'GOAL_CREATED':
      return { summary: `created goal “${d.goal.title}”` };
    case 'DEV_LINKED': {
      const what = { pull_request: 'pull request', commit: 'commit', issue: 'issue', branch: 'branch' }[d.link.kind as string] ?? 'item';
      if (!d.isNew && d.link.kind === 'pull_request') return { summary: `${what} ${d.link.title} is now ${d.link.state}`, taskId: d.task.id };
      return d.isNew ? { summary: `linked ${what} ${d.link.title}`, taskId: d.task.id } : null;
    }
    case 'WORKFLOW_UPDATED':
      return { summary: `updated the workflow (${d.states.map((st: { name: string }) => st.name).join(' → ')})` };
    case 'TASK_RECURRED':
      return { summary: `completed ${d.task.key}; next occurrence ${d.next.key} is due ${d.next.dueDate ?? 'soon'} (${d.rule})`, taskId: d.next.id };
    case 'TASKS_IMPORTED':
      return d.count ? { summary: `imported ${d.count} task${d.count === 1 ? '' : 's'}${d.count > 1 ? ` (${d.first} – ${d.last})` : ` (${d.first})`}` } : null;
    case 'TASK_RESTORED':
      return { summary: `restored ${d.task.key} “${d.task.title}” from the trash`, taskId: d.task.id };
    case 'AUTOMATION_RAN':
      return d.actions.length ? { summary: `ran on ${d.task.key} (${d.actions.map((a: string) => label(a)).join(', ')})`, taskId: d.task.id } : null;
    default:
      return null;
  }
}

@Injectable()
export class ActivityListener {
  private readonly logger = new Logger(ActivityListener.name);
  constructor(private readonly dataSource: DataSource) {}

  @OnEvent(DOMAIN_EVENT, { async: true, promisify: true })
  async handle(e: DomainEvent) {
    try {
      const described = describe(e);
      if (!described) return;
      const changes = e.type === 'TASK_UPDATED' ? { changes: e.data.changes } : {};
      await this.dataSource.getRepository(Activity).insert({
        organizationId: e.organizationId,
        projectId: e.projectId ?? null,
        taskId: described.taskId ?? null,
        actorId: e.actor?.id ?? null,
        actorName: e.actor?.name ?? 'Workora',
        type: e.type,
        summary: described.summary,
        data: { eventId: e.id, ...changes },
      });
    } catch (err) {
      this.logger.error(`Failed to record activity for ${e.type}`, err instanceof Error ? err.stack : err);
    }
  }
}

const toActivityDto = (a: Activity) => ({
  id: a.id,
  type: a.type,
  summary: a.summary,
  actor: a.actorId ? { id: a.actorId, name: a.actorName } : { id: null, name: a.actorName ?? 'Workora' },
  projectId: a.projectId,
  taskId: a.taskId,
  data: a.data,
  createdAt: a.createdAt,
});

@ApiTags('activity')
@ApiBearerAuth()
@Controller()
export class ActivityController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('activity')
  async org(@CurrentUser() u: AuthPrincipal, @Query('limit') limit?: string) {
    return this.query({ organizationId: u.organizationId }, limit);
  }

  @Get('projects/:id/activity')
  async project(@CurrentUser() u: AuthPrincipal, @Param('id') id: string, @Query('limit') limit?: string) {
    const project = await findProject(this.dataSource.manager, u.organizationId, id);
    return this.query({ organizationId: u.organizationId, projectId: project.id }, limit);
  }

  @Get('tasks/:id/activity')
  async task(@CurrentUser() u: AuthPrincipal, @Param('id') id: string, @Query('limit') limit?: string) {
    const task = await findTask(this.dataSource.manager, u.organizationId, id);
    return this.query({ organizationId: u.organizationId, taskId: task.id }, limit);
  }

  private async query(where: FindOptionsWhere<Activity>, limit?: string) {
    const take = Math.min(Math.max(Number(limit) || 30, 1), 200);
    const rows = await this.dataSource.getRepository(Activity).find({ where, order: { createdAt: 'DESC' }, take });
    return rows.map(toActivityDto);
  }
}

@Module({ controllers: [ActivityController], providers: [ActivityListener] })
export class ActivityModule {}
