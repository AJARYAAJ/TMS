import { Injectable, Logger, Module } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { DOMAIN_EVENT, DomainEvent } from '../../common/events/domain-events';
import { EventBus } from '../../common/events/event-bus.service';
import { Membership } from '../organizations/membership.entity';
import { Sprint, SprintStatus } from '../sprints/sprint.entity';
import { TaskStatus } from '../tasks/task.entity';
import { TaskDto } from '../tasks/tasks.dto';
import { TasksModule } from '../tasks/tasks.module';
import { TasksService } from '../tasks/tasks.service';
import { daysBetween, describeRecurrence, nextOccurrence, shiftDate } from './recurrence';

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Recurring tasks: when an occurrence moves into a "done" state — by drag & drop, bulk edit,
 * automation or API — the next occurrence is created with its dates advanced by the rule.
 * A task spawns its successor at most once, so reopening and re-completing never duplicates.
 */
@Injectable()
export class RecurrenceService {
  private readonly logger = new Logger('Recurrence');

  constructor(
    private readonly dataSource: DataSource,
    private readonly tasks: TasksService,
    private readonly events: EventBus,
  ) {}

  @OnEvent(DOMAIN_EVENT, { async: true, promisify: true })
  async onEvent(e: DomainEvent) {
    if (e.type !== 'TASK_UPDATED' || e.data?.changes?.status?.to !== TaskStatus.DONE) return;
    const task: TaskDto = e.data.task;
    if (!task.recurrence) return;
    try {
      await this.spawnNext(e.organizationId, task);
    } catch (err) {
      this.logger.error(`Could not create next occurrence of ${task.key}`, err instanceof Error ? err.stack : err);
    }
  }

  async spawnNext(organizationId: string, task: TaskDto) {
    // Claim the right to spawn atomically (idempotent across retries and re-completions).
    const result = await this.dataSource.query(
      `UPDATE tasks SET recurrence_spawned_at = now() WHERE id = $1 AND recurrence IS NOT NULL AND recurrence_spawned_at IS NULL RETURNING id`,
      [task.id],
    );
    const rows = Array.isArray(result[0]) ? result[0] : result; // pg driver returns [rows, affected] for UPDATE
    if (!rows.length) return null;

    const rule = task.recurrence!;
    const today = localToday();
    const base = task.dueDate ?? today;
    const due = nextOccurrence(rule, base, today);
    if (!due) return null; // series ended
    const delta = daysBetween(base, due);

    const principal = await this.actingAs(organizationId, task);
    if (!principal) return null;
    let sprintId: string | null = null;
    if (task.sprintId) {
      const sprint = await this.dataSource.getRepository(Sprint).findOneBy({ id: task.sprintId });
      if (sprint && sprint.status !== SprintStatus.COMPLETED) sprintId = sprint.id;
    }
    const next = await this.tasks.create(principal, {
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      type: task.type,
      priority: task.priority,
      assigneeId: task.assignee?.id ?? null,
      labelIds: task.labels.map((l) => l.id),
      parentId: task.parentId,
      sprintId,
      storyPoints: task.storyPoints,
      estimateMinutes: task.estimateMinutes,
      dueDate: task.dueDate || !task.startDate ? due : null,
      startDate: task.startDate ? shiftDate(task.startDate, delta) : null,
      recurrence: rule,
    });
    const seriesId = task.seriesId ?? task.id;
    await this.dataSource.query('UPDATE tasks SET series_id = $1 WHERE id = ANY($2)', [seriesId, [task.id, next.id]]);
    this.events.publish('TASK_RECURRED', {
      organizationId,
      projectId: task.projectId,
      actor: { id: principal.userId, name: principal.name },
      data: { task: { ...task, seriesId }, next: { ...next, seriesId }, rule: describeRecurrence(rule) },
    });
    return next;
  }

  /** New occurrences are created on behalf of the reporter (or the assignee if the reporter left). */
  private async actingAs(organizationId: string, task: TaskDto): Promise<AuthPrincipal | null> {
    for (const userId of [task.reporter?.id, task.assignee?.id]) {
      if (!userId) continue;
      const m = await this.dataSource.getRepository(Membership).findOne({ where: { organizationId, userId }, relations: { user: true } });
      if (m) return { userId, organizationId, role: Role.MEMBER, email: m.user.email, name: '↻ Recurring task' };
    }
    return null;
  }
}

@Module({ imports: [TasksModule], providers: [RecurrenceService], exports: [RecurrenceService] })
export class RecurrenceModule {}
