import { Body, Controller, Delete, Get, Injectable, Logger, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { CurrentUser, MinRole } from '../../common/auth/decorators';
import { actorOf, AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { DOMAIN_EVENT, DomainEvent } from '../../common/events/domain-events';
import { EventBus } from '../../common/events/event-bus.service';
import { ApiException } from '../../common/http/api-exception';
import { CommentsModule, CommentsService } from '../comments/comments.module';
import { Label } from '../labels/label.entity';
import { Membership } from '../organizations/membership.entity';
import { findProject } from '../projects/projects.service';
import { Sprint, SprintStatus } from '../sprints/sprint.entity';
import { TASK_STATUSES, TaskPriority } from '../tasks/task.entity';
import { TaskDto } from '../tasks/tasks.dto';
import { TasksModule } from '../tasks/tasks.module';
import { TasksService } from '../tasks/tasks.service';
import { Automation, AutomationAction, AutomationConditions, AutomationTrigger } from './automation.entity';

class AutomationDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsObject() trigger: AutomationTrigger;
  @IsOptional() @IsObject() conditions?: AutomationConditions;
  @IsArray() actions: AutomationAction[];
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class UpdateAutomationDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsObject() trigger?: AutomationTrigger;
  @IsOptional() @IsObject() conditions?: AutomationConditions;
  @IsOptional() @IsArray() actions?: AutomationAction[];
  @IsOptional() @IsBoolean() enabled?: boolean;
}

const TRIGGERS = ['TASK_CREATED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'ASSIGNED', 'COMMENT_ADDED', 'TASK_OVERDUE'];
const PRIORITIES = Object.values(TaskPriority) as string[];

const toDto = (a: Automation) => ({
  id: a.id,
  projectId: a.projectId,
  name: a.name,
  enabled: a.enabled,
  trigger: a.trigger,
  conditions: a.conditions,
  actions: a.actions,
  runCount: a.runCount,
  lastRunAt: a.lastRunAt,
  createdAt: a.createdAt,
});

/**
 * Automation engine: "WHEN <trigger> [IF <conditions>] THEN <actions>".
 * Subscribes to the domain event bus; actions run through the normal services so they are
 * validated, audited and broadcast like any user change. Changes made by a rule carry
 * `actor.automation`, and such events never trigger rules again (no loops).
 */
@Injectable()
export class AutomationsService {
  private readonly logger = new Logger('Automations');

  constructor(
    private readonly dataSource: DataSource,
    private readonly tasks: TasksService,
    private readonly comments: CommentsService,
    private readonly events: EventBus,
  ) {}

  async list(orgId: string, projectIdOrKey: string) {
    const project = await findProject(this.dataSource.manager, orgId, projectIdOrKey);
    const rows = await this.dataSource.getRepository(Automation).find({ where: { projectId: project.id }, order: { createdAt: 'ASC' } });
    return rows.map(toDto);
  }

  async create(u: AuthPrincipal, projectIdOrKey: string, dto: AutomationDto) {
    const project = await findProject(this.dataSource.manager, u.organizationId, projectIdOrKey);
    await this.validate(u.organizationId, dto.trigger, dto.conditions ?? {}, dto.actions);
    const repo = this.dataSource.getRepository(Automation);
    const saved = await repo.save(
      repo.create({ organizationId: u.organizationId, projectId: project.id, name: dto.name.trim(), trigger: dto.trigger, conditions: dto.conditions ?? {}, actions: dto.actions, enabled: dto.enabled ?? true, createdById: u.userId }),
    );
    return toDto(saved);
  }

  async update(u: AuthPrincipal, id: string, dto: UpdateAutomationDto) {
    const repo = this.dataSource.getRepository(Automation);
    const a = await repo.findOneBy({ id, organizationId: u.organizationId });
    if (!a) throw ApiException.notFound('automation');
    Object.assign(a, Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)));
    await this.validate(u.organizationId, a.trigger, a.conditions, a.actions);
    return toDto(await repo.save(a));
  }

  async remove(u: AuthPrincipal, id: string) {
    const result = await this.dataSource.getRepository(Automation).delete({ id, organizationId: u.organizationId });
    if (!result.affected) throw ApiException.notFound('automation');
    return { id, deleted: true };
  }

  @OnEvent(DOMAIN_EVENT, { async: true, promisify: true })
  async onEvent(e: DomainEvent) {
    if (!e.projectId || e.actor?.automation) return;
    const task: TaskDto | undefined = e.data?.task;
    if (!task) return;
    const fired = this.firedTriggers(e);
    if (!fired.length) return;
    try {
      const rules = await this.dataSource
        .getRepository(Automation)
        .createQueryBuilder('a')
        .where('a.project_id = :pid AND a.enabled AND a.trigger ->> :k IN (:...events)', { pid: e.projectId, k: 'event', events: fired.map((f) => f.event) })
        .orderBy('a.created_at', 'ASC')
        .getMany();
      for (const rule of rules) {
        if (!fired.some((f) => this.triggerMatches(rule.trigger, f)) || !this.conditionsMatch(rule.conditions, task)) continue;
        await this.run(rule, e, task);
      }
    } catch (err) {
      this.logger.error(`Automation evaluation failed for ${e.type}`, err instanceof Error ? err.stack : err);
    }
  }

  private firedTriggers(e: DomainEvent): { event: string; from?: string; to?: string }[] {
    switch (e.type) {
      case 'TASK_CREATED':
        return [{ event: 'TASK_CREATED' }];
      case 'TASK_ASSIGNED':
        return [{ event: 'ASSIGNED' }];
      case 'COMMENT_CREATED':
        return [{ event: 'COMMENT_ADDED' }];
      case 'TASK_OVERDUE':
        return [{ event: 'TASK_OVERDUE' }];
      case 'TASK_UPDATED': {
        const out: { event: string; from?: string; to?: string }[] = [];
        const c = e.data.changes ?? {};
        if (c.status) out.push({ event: 'STATUS_CHANGED', from: c.status.from, to: c.status.to });
        if (c.priority) out.push({ event: 'PRIORITY_CHANGED', from: c.priority.from, to: c.priority.to });
        return out;
      }
      default:
        return [];
    }
  }

  private triggerMatches(t: AutomationTrigger, fired: { event: string; from?: string; to?: string }) {
    if (t.event !== fired.event) return false;
    if ('from' in t && t.from && t.from !== fired.from) return false;
    if ('to' in t && t.to && t.to !== fired.to) return false;
    return true;
  }

  private conditionsMatch(c: AutomationConditions, task: TaskDto) {
    if (c.type && task.type !== c.type) return false;
    if (c.priority && task.priority !== c.priority) return false;
    if (c.labelId && !task.labels.some((l) => l.id === c.labelId)) return false;
    return true;
  }

  private async run(rule: Automation, e: DomainEvent, task: TaskDto) {
    const creator = await this.dataSource.getRepository(Membership).findOne({ where: { organizationId: rule.organizationId, userId: rule.createdById }, relations: { user: true } });
    if (!creator) return; // rule author left the organization: rule is inert
    const principal: AuthPrincipal = {
      userId: creator.userId,
      organizationId: rule.organizationId,
      role: Role.OWNER,
      email: creator.user.email,
      name: `⚡ ${rule.name}`,
      automation: rule.id,
    };
    const notify: { userIds: string[]; message: string }[] = [];
    const performed: string[] = [];
    let current = task;
    for (const action of rule.actions) {
      try {
        current = (await this.perform(action, principal, current, notify)) ?? current;
        performed.push(action.type);
      } catch (err: any) {
        this.logger.warn(`Rule "${rule.name}" action ${action.type} on ${task.key} failed: ${err?.message}`);
      }
    }
    await this.dataSource.getRepository(Automation).update({ id: rule.id }, { runCount: () => 'run_count + 1', lastRunAt: new Date() } as any);
    this.events.publish('AUTOMATION_RAN', {
      organizationId: rule.organizationId,
      projectId: e.projectId,
      actor: actorOf(principal),
      data: { automation: { id: rule.id, name: rule.name }, task: current, trigger: e.type, actions: performed, notify },
    });
  }

  private async perform(a: AutomationAction, p: AuthPrincipal, task: TaskDto, notify: { userIds: string[]; message: string }[]) {
    const fill = (s: string) => s.replace(/\{task\.key\}/g, task.key).replace(/\{task\.title\}/g, task.title);
    switch (a.type) {
      case 'SET_STATUS':
        return task.status === a.status ? task : this.tasks.update(p, task.id, { status: a.status as any });
      case 'SET_PRIORITY':
        return task.priority === a.priority ? task : this.tasks.update(p, task.id, { priority: a.priority as any });
      case 'ASSIGN':
        return task.assignee?.id === a.userId ? task : this.tasks.update(p, task.id, { assigneeId: a.userId });
      case 'ASSIGN_REPORTER':
        return !task.reporter || task.assignee?.id === task.reporter.id ? task : this.tasks.update(p, task.id, { assigneeId: task.reporter.id });
      case 'UNASSIGN':
        return task.assignee ? this.tasks.update(p, task.id, { assigneeId: null }) : task;
      case 'ADD_LABEL':
        return task.labels.some((l) => l.id === a.labelId) ? task : this.tasks.update(p, task.id, { labelIds: [...task.labels.map((l) => l.id), a.labelId] });
      case 'MOVE_TO_ACTIVE_SPRINT': {
        const sprint = await this.dataSource.getRepository(Sprint).findOneBy({ projectId: task.projectId, status: SprintStatus.ACTIVE });
        return sprint && task.sprintId !== sprint.id ? this.tasks.update(p, task.id, { sprintId: sprint.id }) : task;
      }
      case 'MOVE_TO_BACKLOG':
        return task.sprintId ? this.tasks.update(p, task.id, { sprintId: null }) : task;
      case 'ADD_COMMENT':
        await this.comments.create(p, task.id, fill(a.body));
        return task;
      case 'NOTIFY': {
        const ids =
          a.target === 'ASSIGNEE' ? [task.assignee?.id]
          : a.target === 'REPORTER' ? [task.reporter?.id]
          : a.target === 'USER' ? [a.userId]
          : (await this.tasks.watchers(task.id)).map((w) => w.id);
        notify.push({ userIds: ids.filter((x): x is string => !!x), message: fill(a.message) });
        return task;
      }
    }
  }

  private async validate(orgId: string, trigger: AutomationTrigger, conditions: AutomationConditions, actions: AutomationAction[]) {
    const bad = (msg: string) => ApiException.badRequest('INVALID_AUTOMATION', msg);
    if (!trigger || !TRIGGERS.includes(trigger.event)) throw bad(`trigger.event must be one of ${TRIGGERS.join(', ')}`);
    const t = trigger as any;
    if (trigger.event === 'STATUS_CHANGED' && ((t.to && !TASK_STATUSES.includes(t.to)) || (t.from && !TASK_STATUSES.includes(t.from)))) throw bad('Invalid status in trigger');
    if (trigger.event === 'PRIORITY_CHANGED' && t.to && !PRIORITIES.includes(t.to)) throw bad('Invalid priority in trigger');
    if (conditions.priority && !PRIORITIES.includes(conditions.priority)) throw bad('Invalid priority condition');
    if (!Array.isArray(actions) || !actions.length || actions.length > 10) throw bad('Provide between 1 and 10 actions');
    for (const a of actions as any[]) {
      switch (a?.type) {
        case 'SET_STATUS':
          if (!TASK_STATUSES.includes(a.status)) throw bad('SET_STATUS needs a valid status');
          break;
        case 'SET_PRIORITY':
          if (!PRIORITIES.includes(a.priority)) throw bad('SET_PRIORITY needs a valid priority');
          break;
        case 'ASSIGN':
          if (!(await this.dataSource.getRepository(Membership).existsBy({ organizationId: orgId, userId: a.userId }))) throw bad('ASSIGN needs a member userId');
          break;
        case 'ADD_LABEL':
          if (!(await this.dataSource.getRepository(Label).existsBy({ organizationId: orgId, id: a.labelId }))) throw bad('ADD_LABEL needs a valid labelId');
          break;
        case 'ADD_COMMENT':
          if (typeof a.body !== 'string' || !a.body.trim()) throw bad('ADD_COMMENT needs a body');
          break;
        case 'NOTIFY':
          if (!['ASSIGNEE', 'REPORTER', 'WATCHERS', 'USER'].includes(a.target) || typeof a.message !== 'string' || !a.message.trim()) throw bad('NOTIFY needs a target and message');
          if (a.target === 'USER' && !(await this.dataSource.getRepository(Membership).existsBy({ organizationId: orgId, userId: a.userId }))) throw bad('NOTIFY USER needs a member userId');
          break;
        case 'ASSIGN_REPORTER':
        case 'UNASSIGN':
        case 'MOVE_TO_ACTIVE_SPRINT':
        case 'MOVE_TO_BACKLOG':
          break;
        default:
          throw bad(`Unknown action type ${a?.type}`);
      }
    }
  }
}

@ApiTags('automations')
@ApiBearerAuth()
@Controller()
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get('projects/:projectId/automations')
  list(@CurrentUser() u: AuthPrincipal, @Param('projectId') projectId: string) {
    return this.automations.list(u.organizationId, projectId);
  }

  @MinRole(Role.ADMIN)
  @Post('projects/:projectId/automations')
  create(@CurrentUser() u: AuthPrincipal, @Param('projectId') projectId: string, @Body() dto: AutomationDto) {
    return this.automations.create(u, projectId, dto);
  }

  @MinRole(Role.ADMIN)
  @Patch('automations/:id')
  update(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAutomationDto) {
    return this.automations.update(u, id, dto);
  }

  @MinRole(Role.ADMIN)
  @Delete('automations/:id')
  remove(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.automations.remove(u, id);
  }
}

@Module({ imports: [TasksModule, CommentsModule], controllers: [AutomationsController], providers: [AutomationsService] })
export class AutomationsModule {}
