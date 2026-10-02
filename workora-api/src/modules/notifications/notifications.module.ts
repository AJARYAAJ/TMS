import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Logger, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsObject, IsOptional, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';
import { DataSource, In, IsNull } from 'typeorm';
import { CurrentUser } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { DOMAIN_EVENT, DomainEvent, SECURITY_NOTICE, SecurityNotice } from '../../common/events/domain-events';
import { paginated } from '../../common/http/api-response';
import { ApiException } from '../../common/http/api-exception';
import { APP_CONFIG, AppConfig } from '../../config';
import { EMAIL_CATEGORIES, EmailCategory, effectivePushPrefs, isEmailCategory, NotificationCategory, wantsEmail, wantsPush } from '../email/email-prefs';
import { taskUrl } from '../integrations/shared';
import { JobScheduler, JobsModule } from '../jobs/jobs.module';
import { Membership } from '../organizations/membership.entity';
import { Organization } from '../organizations/organization.entity';
import { Project } from '../projects/project.entity';
import { rooms, RealtimeGateway } from '../realtime/realtime.gateway';
import { Task } from '../tasks/task.entity';
import { User } from '../users/user.entity';
import { Notification } from './notification.entity';
import { PushService } from './push.service';

interface Draft {
  userId: string;
  type: string;
  title: string;
  body?: string;
  /** Decides email and desktop delivery against the recipient's preferences. */
  category: NotificationCategory;
  /** In-app path when the notification isn't about the event's task (a goal, the trash, a sprint). */
  link?: string;
  /** False when the event's task can't be opened any more (it was trashed). */
  withTask?: boolean;
}

/** One notification per user per event (a mention wins over a plain "commented"). */
function dedupe(drafts: Draft[]) {
  const seen = new Set<string>();
  return drafts.filter((d) => !seen.has(d.userId) && seen.add(d.userId));
}

const toNotificationDto = (n: Notification) => ({
  id: n.id,
  type: n.type,
  category: n.category,
  title: n.title,
  body: n.body,
  actor: n.actorId ? { id: n.actorId, name: n.actorName } : null,
  projectId: n.projectId,
  taskId: n.taskId,
  taskKey: n.taskKey,
  link: n.link,
  read: !!n.readAt,
  createdAt: n.createdAt,
});

const label = (s: unknown) => String(s ?? '').replace(/_/g, ' ').toLowerCase();
const day = (d: unknown) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null);
const taskPath = (key: string) => `/projects/${key.split('-')[0]}/board?task=${key}`;

/** Notifications from another workspace switch to it when opened (the SPA reads ?org=). */
const withOrg = (url: string, organizationId: string) => `${url}${url.includes('?') ? '&' : '?'}org=${organizationId}`;

/**
 * Notification service: decides who should hear about an event, stores in-app notifications,
 * pushes them over the websocket, sends desktop (Web Push) notifications and queues email.
 */
@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly realtime: RealtimeGateway,
    private readonly jobs: JobScheduler,
    private readonly push: PushService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @OnEvent(DOMAIN_EVENT, { async: true, promisify: true })
  async handle(e: DomainEvent) {
    try {
      // Never notify people about their own actions — except rule-driven ones they didn't make by hand.
      const drafts = dedupe(await this.draft(e)).filter((d) => d.userId !== e.actor?.id || (!!e.actor?.automation && e.type === 'AUTOMATION_RAN'));
      if (!drafts.length) return;
      const task = e.data?.task as { id: string; key: string; title: string } | undefined;
      const rows = await this.store(
        drafts.map((d) => ({
          organizationId: e.organizationId,
          userId: d.userId,
          actorId: e.actor?.id ?? null,
          actorName: e.actor?.name ?? 'Workora',
          type: d.type,
          category: d.category,
          title: d.title,
          body: d.body ?? '',
          projectId: e.projectId ?? null,
          taskId: d.withTask === false ? null : (task?.id ?? null),
          taskKey: d.withTask === false ? null : (task?.key ?? null),
          link: d.link ?? null,
        })),
        e.actor,
      );
      await this.sendPushes(rows);
      await this.queueEmails(e, drafts.filter((d) => isEmailCategory(d.category)));
    } catch (err) {
      this.logger.error(`Failed to create notifications for ${e.type}`, err instanceof Error ? err.stack : err);
    }
  }

  /** Security notices are about the account, so they show in every workspace; desktop gets one. */
  @OnEvent(SECURITY_NOTICE, { async: true, promisify: true })
  async security(n: SecurityNotice) {
    try {
      const memberships = await this.dataSource.getRepository(Membership).find({ where: { userId: n.userId }, select: { organizationId: true } });
      const rows = await this.store(
        memberships.map((m) => ({ organizationId: m.organizationId, userId: n.userId, actorId: null, actorName: 'Workora', type: 'SECURITY', category: 'security', title: n.title, body: n.body, link: '/settings' })),
        null,
      );
      if (rows[0]) await this.sendPushes([rows[0]]);
    } catch (err) {
      this.logger.error('Failed to create a security notification', err instanceof Error ? err.stack : err);
    }
  }

  private async store(rows: Partial<Notification>[], actor: DomainEvent['actor']) {
    if (!rows.length) return [];
    const repo = this.dataSource.getRepository(Notification);
    const saved = await repo.save(rows.map((r) => repo.create(r)));
    for (const n of saved) {
      this.realtime.publish([rooms.user(n.userId)], {
        id: n.id,
        type: 'NOTIFICATION_CREATED',
        projectId: n.projectId ?? undefined,
        actor,
        occurredAt: new Date().toISOString(),
        data: toNotificationDto(n),
      });
    }
    return saved;
  }

  /** Desktop notifications for recipients who want this category; sent in the background. */
  private async sendPushes(rows: Notification[]) {
    const users = await this.dataSource.getRepository(User).find({ where: { id: In(rows.map((r) => r.userId)) }, select: { id: true, pushPrefs: true } });
    const prefs = new Map(users.map((u) => [u.id, u.pushPrefs]));
    const wanted = rows.filter((r) => prefs.has(r.userId) && wantsPush(prefs.get(r.userId), (r.category ?? 'status') as NotificationCategory));
    if (!wanted.length) return;
    const orgs = new Map((await this.dataSource.getRepository(Organization).findBy({ id: In([...new Set(wanted.map((r) => r.organizationId))]) })).map((o) => [o.id, o.name]));
    for (const n of wanted) {
      const url = n.link ? `${this.config.appUrl}${n.link}` : n.taskKey ? taskUrl(this.config.appUrl, n.taskKey) : `${this.config.appUrl}/inbox`;
      this.push
        .send(n.userId, { id: n.id, title: n.title, body: n.body, url: withOrg(url, n.organizationId), category: n.category ?? 'status', organization: orgs.get(n.organizationId) })
        .catch((err) => this.logger.warn(`Desktop notification failed: ${err instanceof Error ? err.message : err}`));
    }
  }

  private async draft(e: DomainEvent): Promise<Draft[]> {
    const who = e.actor?.name ?? 'Workora';
    const d = e.data;
    switch (e.type) {
      case 'TASK_ASSIGNED':
        return d.task.assignee ? [{ userId: d.task.assignee.id, type: e.type, title: `${who} assigned ${d.task.key} to you`, body: d.task.title, category: 'assigned' }] : [];
      case 'COMMENT_CREATED': {
        const mentioned = new Set<string>(d.mentionedUserIds);
        const drafts: Draft[] = [...mentioned].map((userId) => ({ userId, type: 'MENTIONED', title: `${who} mentioned you in ${d.task.key}`, body: d.comment.body.slice(0, 280), category: 'mentioned' }));
        const watchers = (await this.watcherIds(d.task.id, [d.task.assignee?.id, d.task.reporter?.id])).filter((id) => !mentioned.has(id));
        for (const userId of watchers) drafts.push({ userId, type: e.type, title: `${who} commented on ${d.task.key}`, body: d.comment.body.slice(0, 280), category: 'comments' });
        return drafts;
      }
      case 'TASK_UPDATED':
        return this.taskChanges(e, who);
      case 'TASK_OVERDUE':
        return d.task.assignee ? [{ userId: d.task.assignee.id, type: e.type, title: `${d.task.key} is overdue`, body: `${d.task.title} was due ${day(d.task.dueDate)}`, category: 'overdue' }] : [];
      case 'TASK_DUE_SOON':
        return d.task.assignee ? [{ userId: d.task.assignee.id, type: e.type, title: `${d.task.key} is due tomorrow`, body: d.task.title, category: 'dueSoon' }] : [];
      case 'AUTOMATION_RAN':
        return (d.notify as { userIds: string[]; message: string }[]).flatMap((n) => n.userIds.map((userId) => ({ userId, type: 'AUTOMATION', title: n.message, body: `${d.automation.name} · ${d.task.key}`, category: 'automation' as const })));
      case 'SPRINT_STARTED':
      case 'SPRINT_COMPLETED': {
        const assignees = await this.dataSource.getRepository(Task).find({ select: { assigneeId: true }, where: { sprintId: d.sprint.id } });
        const verb = e.type === 'SPRINT_STARTED' ? 'started' : 'completed';
        const link = (await this.projectPath(e.projectId, 'sprint')) ?? undefined;
        return [...new Set(assignees.map((t) => t.assigneeId).filter((id): id is string => !!id))].map((userId) => ({ userId, type: e.type, title: `${d.sprint.name} ${verb}`, body: d.sprint.goal, category: 'sprints' as const, link }));
      }
      case 'USER_ADDED':
        return [{ userId: d.user.id, type: e.type, title: `${who} added you to the organization`, body: `Your role: ${label(d.role)}`, category: 'workspace', link: '/' }];
      case 'ATTACHMENT_ADDED':
        return (await this.watcherIds(d.task.id)).map((userId) => ({ userId, type: e.type, title: `${who} attached ${d.attachment.fileName} to ${d.task.key}`, body: d.task.title, category: 'changes' as const }));
      case 'TASK_LINKED': {
        if (d.link.type !== 'BLOCKS') return [];
        // The blocked task's people need to know their work now waits on something else.
        const blocked = await this.dataSource.getRepository(Task).findOne({ where: { key: d.link.target, organizationId: e.organizationId }, select: { id: true, key: true, assigneeId: true, title: true } });
        if (!blocked) return [];
        return (await this.watcherIds(blocked.id, [blocked.assigneeId])).map((userId) => ({
          userId,
          type: 'TASK_BLOCKED',
          title: `${blocked.key} is now blocked by ${d.link.source}`,
          body: `${who} added the dependency · ${blocked.title}`,
          category: 'changes' as const,
          link: taskPath(blocked.key),
        }));
      }
      case 'TASK_DELETED':
        if (!d.trashed) return [];
        return (await this.watcherIds(d.task.id, [d.task.assignee?.id])).map((userId) => ({ userId, type: 'TASK_TRASHED', title: `${who} moved ${d.task.key} to the trash`, body: d.task.title, category: 'changes' as const, link: '/trash', withTask: false }));
      case 'TASK_RESTORED':
        return (await this.watcherIds(d.task.id, [d.task.assignee?.id])).map((userId) => ({ userId, type: e.type, title: `${who} restored ${d.task.key} from the trash`, body: d.task.title, category: 'changes' as const }));
      case 'DEV_LINKED': {
        const l = d.link as { kind: string; state: string; title: string; externalId: string };
        const pr = l.kind === 'pull_request';
        if (!(pr ? d.isNew || l.state === 'merged' || l.state === 'closed' : l.kind === 'issue' && d.isNew)) return [];
        const what = `${pr ? 'Pull request' : 'Issue'} #${l.externalId}`;
        const verb = d.isNew ? 'linked to' : l.state === 'merged' ? 'merged for' : 'closed for';
        return (await this.watcherIds(d.task.id, [d.task.assignee?.id])).map((userId) => ({ userId, type: e.type, title: `${what} ${verb} ${d.task.key}`, body: l.title, category: 'development' as const }));
      }
      case 'TASK_RECURRED': {
        // The event's task is the one just finished; this notification is about the new occurrence.
        const next = d.next as { key: string; title: string; dueDate?: string | null; assignee?: { id: string } | null };
        if (!next.assignee) return [];
        const due = day(next.dueDate);
        return [{ userId: next.assignee.id, type: e.type, title: `Next ${next.key} is ready${due ? ` · due ${due}` : ''}`, body: `${next.title} (repeats ${d.rule})`, category: 'assigned', link: taskPath(next.key), withTask: false }];
      }
      case 'FORM_SUBMITTED':
        return [{ userId: d.form.createdById, type: e.type, title: `New response to “${d.form.name}” → ${d.task.key}`, body: d.task.title, category: 'forms' }];
      case 'GOAL_UPDATED': {
        const owner = d.goal?.owner?.id as string | undefined;
        if (!owner) return [];
        const link = (await this.projectPath(e.projectId, 'goals')) ?? '/goals';
        return [{ userId: owner, type: e.type, title: `${who} updated your goal “${d.goal.title}”`, body: `${Math.round(d.goal.progress ?? 0)}% · ${label(d.goal.status)}`, category: 'goals', link }];
      }
      default:
        return [];
    }
  }

  /**
   * Someone taken off a task hears about it; state changes reach watchers, the reporter and the
   * assignee; priority and due date changes reach watchers and the assignee.
   */
  private async taskChanges(e: DomainEvent, who: string): Promise<Draft[]> {
    const { task, changes } = e.data;
    const drafts: Draft[] = [];
    const assignee = task.assignee?.id as string | undefined;
    const previous = changes.assigneeId?.from as string | null | undefined;
    if (previous && previous !== assignee) drafts.push({ userId: previous, type: 'TASK_UNASSIGNED', title: `${who} took you off ${task.key}`, body: task.title, category: 'assigned' });

    if (changes.state || changes.status) {
      const to = (changes.state?.to ?? label(changes.status.to)).toLowerCase();
      for (const userId of await this.watcherIds(task.id, [task.reporter?.id, assignee])) {
        drafts.push({ userId, type: 'TASK_STATUS_CHANGED', title: `${who} moved ${task.key} to ${to}`, body: task.title, category: 'status' });
      }
    }

    const priority = changes.priority ? label(changes.priority.to) : null;
    const due = 'dueDate' in changes ? day(changes.dueDate.to) : undefined;
    const what =
      priority && due !== undefined
        ? `changed the priority and due date of ${task.key}`
        : priority
          ? `set ${task.key} to ${priority} priority`
          : due
            ? `moved the due date of ${task.key} to ${due}`
            : due === null
              ? `removed the due date of ${task.key}`
              : null;
    if (what) {
      for (const userId of await this.watcherIds(task.id, [assignee])) drafts.push({ userId, type: 'TASK_CHANGED', title: `${who} ${what}`, body: task.title, category: 'changes' });
    }
    return drafts;
  }

  private async watcherIds(taskId: string, extra: (string | undefined | null)[] = []) {
    const rows: { user_id: string }[] = await this.dataSource.query('SELECT user_id FROM task_watchers WHERE task_id = $1', [taskId]);
    return [...new Set([...rows.map((r) => r.user_id), ...extra.filter((x): x is string => !!x)])];
  }

  private async projectPath(projectId: string | undefined, view: string) {
    if (!projectId) return null;
    const p = await this.dataSource.getRepository(Project).findOne({ where: { id: projectId }, select: { id: true, key: true } });
    return p ? `/projects/${p.key}/${view}` : null;
  }

  /** Queues one email per draft whose recipient wants that category (re-checked at send time). */
  private async queueEmails(e: DomainEvent, drafts: Draft[]) {
    if (!drafts.length) return;
    const users = await this.dataSource.getRepository(User).find({ where: { id: In(drafts.map((d) => d.userId)) }, select: { id: true, emailPrefs: true } });
    const prefs = new Map(users.map((u) => [u.id, u.emailPrefs]));
    const wanted = drafts.filter((d) => prefs.has(d.userId) && wantsEmail(prefs.get(d.userId), d.category as EmailCategory));
    if (!wanted.length) return;
    const org = await this.dataSource.getRepository(Organization).findOneBy({ id: e.organizationId });
    const task = e.data?.task as { key: string; title: string } | undefined;
    for (const d of wanted) {
      const withTask = task && d.withTask !== false;
      await this.jobs.enqueueEmail({
        organizationId: e.organizationId,
        userId: d.userId,
        category: d.category as EmailCategory,
        subject: task && !d.title.includes(task.key) ? `[${task.key}] ${d.title}` : d.title,
        heading: d.title,
        body: d.body && d.body !== task?.title ? d.body : undefined,
        actorName: e.actor?.name ?? null,
        orgName: org?.name ?? 'Workora',
        task: withTask ? { key: task.key, title: task.title } : null,
        url: d.link ? `${this.config.appUrl}${d.link}` : withTask ? taskUrl(this.config.appUrl, task.key) : `${this.config.appUrl}/inbox`,
      });
    }
  }
}

class PushKeysDto {
  @IsString() @MaxLength(200) p256dh: string;
  @IsString() @MaxLength(100) auth: string;
}

class SubscribeDto {
  @IsUrl({ require_tld: false, protocols: ['https'], require_protocol: true }) @MaxLength(2000) endpoint: string;
  @IsDefined() @ValidateNested() @Type(() => PushKeysDto) keys: PushKeysDto;
  @IsOptional() @IsString() @MaxLength(200) device?: string;
}

class UnsubscribeDto {
  @IsString() @MaxLength(2000) endpoint: string;
}

class PushPrefsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsObject() categories?: Record<string, boolean>;
}

const categoryOptions = () => (Object.keys(EMAIL_CATEGORIES) as EmailCategory[]).map((key) => ({ key, label: EMAIL_CATEGORIES[key].label, description: EMAIL_CATEGORIES[key].description }));

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly push: PushService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

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

  /** Desktop notification setup: the VAPID public key, this person's preferences and browsers. */
  @Get('push')
  async pushConfig(@CurrentUser() u: AuthPrincipal) {
    const [{ publicKey }, user, devices] = await Promise.all([
      this.push.vapidKeys(),
      this.dataSource.getRepository(User).findOneOrFail({ where: { id: u.userId }, select: { id: true, pushPrefs: true } }),
      this.push.devices(u.userId),
    ]);
    return { publicKey, ...effectivePushPrefs(user.pushPrefs), options: categoryOptions(), devices };
  }

  @Patch('push')
  async updatePush(@CurrentUser() u: AuthPrincipal, @Body() dto: PushPrefsDto) {
    const patch: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(dto.categories ?? {})) {
      if (!isEmailCategory(k)) throw ApiException.badRequest('UNKNOWN_CATEGORY', `Unknown notification category "${k}"`);
      if (typeof v !== 'boolean') throw ApiException.badRequest('VALIDATION_ERROR', `categories.${k} must be a boolean`);
      patch[k] = v;
    }
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    await this.dataSource.query(`UPDATE users SET push_prefs = push_prefs || $2::jsonb WHERE id = $1`, [u.userId, JSON.stringify(patch)]);
    return this.pushConfig(u);
  }

  @Post('push/subscriptions')
  async subscribe(@CurrentUser() u: AuthPrincipal, @Body() dto: SubscribeDto) {
    await this.push.subscribe(u.userId, dto, dto.device ?? '');
    return { subscribed: true, devices: await this.push.devices(u.userId) };
  }

  @HttpCode(200)
  @Delete('push/subscriptions')
  async unsubscribe(@CurrentUser() u: AuthPrincipal, @Body() dto: UnsubscribeDto) {
    return { removed: await this.push.unsubscribe(u.userId, dto.endpoint) };
  }

  @HttpCode(200)
  @Post('push/test')
  async test(@CurrentUser() u: AuthPrincipal) {
    const result = await this.push.send(u.userId, {
      id: `test-${Date.now()}`,
      title: 'Desktop notifications work',
      body: 'This is how Workora reaches you when you are in another tab or app.',
      url: `${this.config.appUrl}/settings`,
      category: 'test',
    });
    if (!result.sent && !result.failed) throw ApiException.badRequest('NO_DEVICES', 'Turn on desktop notifications in this browser first');
    return result;
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

@Module({ imports: [JobsModule], controllers: [NotificationsController], providers: [NotificationListener, PushService] })
export class NotificationsModule {}
