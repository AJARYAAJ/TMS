import { Controller, Get, HttpCode, Injectable, Logger, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DataSource, In, IsNull } from 'typeorm';
import { CurrentUser } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { DOMAIN_EVENT, DomainEvent } from '../../common/events/domain-events';
import { paginated } from '../../common/http/api-response';
import { ApiException } from '../../common/http/api-exception';
import { JobScheduler, JobsModule } from '../jobs/jobs.module';
import { rooms, RealtimeGateway } from '../realtime/realtime.gateway';
import { Task } from '../tasks/task.entity';
import { User } from '../users/user.entity';
import { Notification } from './notification.entity';

interface Draft {
  userId: string;
  type: string;
  title: string;
  body?: string;
  email?: boolean;
}

/** One notification per user per event (a mention wins over a plain "commented"). */
function dedupe(drafts: Draft[]) {
  const seen = new Set<string>();
  return drafts.filter((d) => !seen.has(d.userId) && seen.add(d.userId));
}

const toNotificationDto = (n: Notification) => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  actor: n.actorId ? { id: n.actorId, name: n.actorName } : null,
  projectId: n.projectId,
  taskId: n.taskId,
  taskKey: n.taskKey,
  read: !!n.readAt,
  createdAt: n.createdAt,
});

/**
 * Notification service: decides who should hear about an event, stores in-app
 * notifications, pushes them over the websocket and queues email delivery.
 */
@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly realtime: RealtimeGateway,
    private readonly jobs: JobScheduler,
  ) {}

  @OnEvent(DOMAIN_EVENT, { async: true, promisify: true })
  async handle(e: DomainEvent) {
    try {
      // Never notify people about their own actions — except rule-driven ones they didn't make by hand.
      const drafts = dedupe(await this.draft(e)).filter((d) => d.userId !== e.actor?.id || (!!e.actor?.automation && e.type === 'AUTOMATION_RAN'));
      if (!drafts.length) return;
      const task = e.data?.task;
      const rows = await this.dataSource.getRepository(Notification).save(
        drafts.map((d) =>
          this.dataSource.getRepository(Notification).create({
            organizationId: e.organizationId,
            userId: d.userId,
            actorId: e.actor?.id ?? null,
            actorName: e.actor?.name ?? 'Workora',
            type: d.type,
            title: d.title,
            body: d.body ?? '',
            projectId: e.projectId ?? null,
            taskId: task?.id ?? null,
            taskKey: task?.key ?? null,
          }),
        ),
      );
      for (const n of rows) {
        this.realtime.publish([rooms.user(n.userId)], {
          id: n.id,
          type: 'NOTIFICATION_CREATED',
          projectId: n.projectId ?? undefined,
          actor: e.actor,
          occurredAt: new Date().toISOString(),
          data: toNotificationDto(n),
        });
      }
      await this.queueEmails(drafts.filter((d) => d.email));
    } catch (err) {
      this.logger.error(`Failed to create notifications for ${e.type}`, err instanceof Error ? err.stack : err);
    }
  }

  private async draft(e: DomainEvent): Promise<Draft[]> {
    const who = e.actor?.name ?? 'Workora';
    const d = e.data;
    switch (e.type) {
      case 'TASK_ASSIGNED':
        return d.task.assignee ? [{ userId: d.task.assignee.id, type: e.type, title: `${who} assigned ${d.task.key} to you`, body: d.task.title, email: true }] : [];
      case 'COMMENT_CREATED': {
        const mentioned = new Set<string>(d.mentionedUserIds);
        const drafts: Draft[] = [...mentioned].map((userId) => ({ userId, type: 'MENTIONED', title: `${who} mentioned you in ${d.task.key}`, body: d.comment.body.slice(0, 280), email: true }));
        const watchers = (await this.watcherIds(d.task.id, [d.task.assignee?.id, d.task.reporter?.id])).filter((id) => !mentioned.has(id));
        for (const userId of watchers) drafts.push({ userId, type: e.type, title: `${who} commented on ${d.task.key}`, body: d.comment.body.slice(0, 280) });
        return drafts;
      }
      case 'TASK_UPDATED': {
        if (!d.changes.status) return [];
        const assignee = d.task.assignee?.id;
        const status = String(d.changes.status.to).replace(/_/g, ' ').toLowerCase();
        return (await this.watcherIds(d.task.id, [d.task.reporter?.id]))
          .filter((id) => id !== assignee || !!e.actor?.automation)
          .map((userId) => ({ userId, type: 'TASK_STATUS_CHANGED', title: `${who} moved ${d.task.key} to ${status}`, body: d.task.title }));
      }
      case 'TASK_OVERDUE':
        return d.task.assignee ? [{ userId: d.task.assignee.id, type: e.type, title: `${d.task.key} is overdue`, body: `${d.task.title} was due ${d.task.dueDate}`, email: true }] : [];
      case 'AUTOMATION_RAN':
        return (d.notify as { userIds: string[]; message: string }[]).flatMap((n) => n.userIds.map((userId) => ({ userId, type: 'AUTOMATION', title: n.message, body: `${d.automation.name} · ${d.task.key}` })));
      case 'SPRINT_STARTED':
      case 'SPRINT_COMPLETED': {
        const assignees = await this.dataSource.getRepository(Task).find({ select: { assigneeId: true }, where: { sprintId: d.sprint.id } });
        const verb = e.type === 'SPRINT_STARTED' ? 'started' : 'completed';
        return [...new Set(assignees.map((t) => t.assigneeId).filter((id): id is string => !!id))].map((userId) => ({ userId, type: e.type, title: `${d.sprint.name} ${verb}`, body: d.sprint.goal }));
      }
      case 'USER_ADDED':
        return [{ userId: d.user.id, type: e.type, title: `${who} added you to the organization`, body: `Your role: ${d.role}` }];
      default:
        return [];
    }
  }

  private async watcherIds(taskId: string, extra: (string | undefined)[] = []) {
    const rows: { user_id: string }[] = await this.dataSource.query('SELECT user_id FROM task_watchers WHERE task_id = $1', [taskId]);
    return [...new Set([...rows.map((r) => r.user_id), ...extra.filter((x): x is string => !!x)])];
  }

  private async queueEmails(drafts: Draft[]) {
    if (!drafts.length) return;
    const users = await this.dataSource.getRepository(User).findBy({ id: In(drafts.map((d) => d.userId)) });
    const emails = new Map(users.map((u) => [u.id, u.email]));
    for (const d of drafts) {
      const to = emails.get(d.userId);
      if (to) await this.jobs.enqueueEmail({ to, subject: d.title, body: d.body ?? '' });
    }
  }
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async list(@CurrentUser() u: AuthPrincipal, @Query('unread') unread?: string, @Query('page') page = '1', @Query('size') size = '20') {
    const p = Math.max(Number(page) || 1, 1);
    const s = Math.min(Math.max(Number(size) || 20, 1), 100);
    const where = { organizationId: u.organizationId, userId: u.userId, ...(unread === 'true' ? { readAt: IsNull() } : {}) };
    const repo = this.dataSource.getRepository(Notification);
    const [rows, total] = await repo.findAndCount({ where, order: { createdAt: 'DESC' }, skip: (p - 1) * s, take: s });
    const result = paginated(rows.map(toNotificationDto), p, s, total);
    const unreadCount = await repo.countBy({ organizationId: u.organizationId, userId: u.userId, readAt: IsNull() });
    return Object.assign(result, { meta: { ...result.meta, unreadCount } });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() u: AuthPrincipal) {
    return { count: await this.dataSource.getRepository(Notification).countBy({ organizationId: u.organizationId, userId: u.userId, readAt: IsNull() }) };
  }

  @HttpCode(200)
  @Post(':id/read')
  async markRead(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    const repo = this.dataSource.getRepository(Notification);
    const n = await repo.findOneBy({ id, userId: u.userId, organizationId: u.organizationId });
    if (!n) throw ApiException.notFound('notification');
    if (!n.readAt) await repo.update({ id }, { readAt: new Date() });
    return { id, read: true };
  }

  @HttpCode(200)
  @Post('read-all')
  async markAllRead(@CurrentUser() u: AuthPrincipal) {
    const result = await this.dataSource.getRepository(Notification).update({ organizationId: u.organizationId, userId: u.userId, readAt: IsNull() }, { readAt: new Date() });
    return { updated: result.affected ?? 0 };
  }
}

@Module({ imports: [JobsModule], controllers: [NotificationsController], providers: [NotificationListener] })
export class NotificationsModule {}
