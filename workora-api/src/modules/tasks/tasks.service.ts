import { Injectable } from '@nestjs/common';
import { Brackets, DataSource, EntityManager } from 'typeorm';
import { actorOf, AuthPrincipal } from '../../common/auth/principal';
import { FieldChange } from '../../common/events/domain-events';
import { EventBus } from '../../common/events/event-bus.service';
import { ApiResult, paginated } from '../../common/http/api-response';
import { ApiException } from '../../common/http/api-exception';
import { isUuid } from '../../common/http/identifiers';
import { Membership } from '../organizations/membership.entity';
import { findProject } from '../projects/projects.service';
import { Sprint, SprintStatus } from '../sprints/sprint.entity';
import { Task, TASK_STATUSES, TaskStatus } from './task.entity';
import { CreateTaskDto, ListTasksQuery, MoveTaskDto, TaskDto, toTaskDto, UpdateTaskDto } from './tasks.dto';

const TASK_RELATIONS = { assignee: true, reporter: true } as const;
const NULLABLE = new Set(['assigneeId', 'sprintId', 'storyPoints', 'startDate', 'dueDate']);
const EDITABLE = ['title', 'description', 'type', 'priority', 'assigneeId', 'sprintId', 'storyPoints', 'startDate', 'dueDate'] as const;

/** Resolve a task by UUID or human key (ECOM-102) within the tenant. */
export async function findTask(m: EntityManager, orgId: string, idOrKey: string) {
  const where = isUuid(idOrKey) ? { id: idOrKey, organizationId: orgId } : { key: idOrKey.toUpperCase(), organizationId: orgId };
  const task = await m.findOne(Task, { where, relations: TASK_RELATIONS });
  if (!task) throw ApiException.notFound('task');
  return task;
}

/** Serialises structural changes (numbering, board ordering) per project. */
async function lockProject(m: EntityManager, projectId: string) {
  await m.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [projectId]);
}

async function nextTaskNumber(m: EntityManager, projectId: string): Promise<number> {
  const result = await m
    .createQueryBuilder()
    .update('projects')
    .set({ taskSeq: () => 'task_seq + 1' })
    .where('id = :projectId', { projectId })
    .returning('task_seq')
    .execute();
  return Number(result.raw[0].task_seq);
}

/** Rewrites 0..n-1 positions for a column, optionally inserting `insert` at `index`. */
async function reorderColumn(m: EntityManager, projectId: string, status: TaskStatus, exclude?: Task, insert?: { task: Task; index: number }) {
  const column = await m.find(Task, { where: { projectId, status }, order: { position: 'ASC', createdAt: 'ASC' } });
  const ordered = column.filter((t) => t.id !== exclude?.id && t.id !== insert?.task.id);
  if (insert) ordered.splice(Math.min(insert.index, ordered.length), 0, insert.task);
  const updates = ordered
    .map((t, i) => ({ t, i }))
    .filter(({ t, i }) => t.position !== i || t === insert?.task);
  for (const { t, i } of updates) {
    if (t === insert?.task) {
      t.position = i;
    } else {
      await m.update(Task, { id: t.id }, { position: i });
    }
  }
}

@Injectable()
export class TasksService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  async list(principal: AuthPrincipal, q: ListTasksQuery): Promise<ApiResult<TaskDto[]>> {
    const page = q.page ?? 1;
    const size = q.size ?? 50;
    const qb = this.dataSource
      .getRepository(Task)
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .leftJoinAndSelect('t.reporter', 'reporter')
      .where('t.organizationId = :orgId', { orgId: principal.organizationId });

    if (q.projectId) {
      const project = await findProject(this.dataSource.manager, principal.organizationId, q.projectId);
      qb.andWhere('t.projectId = :projectId', { projectId: project.id });
    }
    if (q.status) {
      const statuses = q.status.split(',').map((s) => s.trim().toUpperCase());
      if (statuses.some((s) => !TASK_STATUSES.includes(s as TaskStatus))) throw ApiException.badRequest('INVALID_STATUS', `status must be one of ${TASK_STATUSES.join(', ')}`);
      qb.andWhere('t.status IN (:...statuses)', { statuses });
    }
    if (q.assigneeId === 'me') qb.andWhere('t.assigneeId = :me', { me: principal.userId });
    else if (q.assigneeId === 'none') qb.andWhere('t.assigneeId IS NULL');
    else if (q.assigneeId) qb.andWhere('t.assigneeId = :assigneeId', { assigneeId: q.assigneeId });
    if (q.sprintId === 'none') qb.andWhere('t.sprintId IS NULL');
    else if (q.sprintId === 'active') qb.innerJoin(Sprint, 's', 's.id = t.sprintId AND s.status = :active', { active: SprintStatus.ACTIVE });
    else if (q.sprintId) qb.andWhere('t.sprintId = :sprintId', { sprintId: q.sprintId });
    if (q.type) qb.andWhere('t.type = :type', { type: q.type });
    if (q.priority) qb.andWhere('t.priority = :priority', { priority: q.priority });
    if (q.open === 'true') qb.andWhere('t.status <> :done', { done: TaskStatus.DONE });
    if (q.open === 'false') qb.andWhere('t.status = :done', { done: TaskStatus.DONE });
    if (q.dueFrom) qb.andWhere('t.dueDate >= :dueFrom', { dueFrom: q.dueFrom });
    if (q.dueTo) qb.andWhere('t.dueDate <= :dueTo', { dueTo: q.dueTo });
    if (q.q) {
      qb.andWhere(new Brackets((b) => b.where('t.title ILIKE :like', { like: `%${escapeLike(q.q!)}%` }).orWhere('t.key ILIKE :like')));
    }

    const order = (q.order ?? 'asc').toUpperCase() as 'ASC' | 'DESC';
    switch (q.sort ?? 'position') {
      case 'priority':
        qb.addSelect(`CASE t.priority WHEN 'URGENT' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END`, 'priority_rank')
          .orderBy('priority_rank', order === 'ASC' ? 'DESC' : 'ASC');
        break;
      case 'dueDate':
        qb.orderBy('t.dueDate', order, 'NULLS LAST');
        break;
      case 'createdAt':
      case 'updatedAt':
        qb.orderBy(`t.${q.sort}`, order);
        break;
      default:
        qb.orderBy('t.status', 'ASC').addOrderBy('t.position', order);
    }
    qb.addOrderBy('t.number', 'ASC').skip((page - 1) * size).take(size);

    const [rows, total] = await qb.getManyAndCount();
    return paginated(rows.map(toTaskDto), page, size, total);
  }

  async get(orgId: string, idOrKey: string) {
    return toTaskDto(await findTask(this.dataSource.manager, orgId, idOrKey));
  }

  async board(orgId: string, projectIdOrKey: string, sprintId?: string) {
    const project = await findProject(this.dataSource.manager, orgId, projectIdOrKey);
    const where: Record<string, unknown> = { projectId: project.id };
    if (sprintId && isUuid(sprintId)) where.sprintId = sprintId;
    const tasks = await this.dataSource.getRepository(Task).find({ where, relations: TASK_RELATIONS, order: { position: 'ASC', number: 'ASC' } });
    return {
      projectId: project.id,
      columns: TASK_STATUSES.map((status) => ({ status, tasks: tasks.filter((t) => t.status === status).map(toTaskDto) })),
    };
  }

  async create(principal: AuthPrincipal, dto: CreateTaskDto) {
    const task = await this.dataSource.transaction(async (m) => {
      const project = await findProject(m, principal.organizationId, dto.projectId);
      await this.validateRefs(m, principal.organizationId, project.id, dto);
      await lockProject(m, project.id);
      const number = await nextTaskNumber(m, project.id);
      const status = dto.status ?? TaskStatus.TODO;
      const position = await m.count(Task, { where: { projectId: project.id, status } });
      const saved = await m.save(
        m.create(Task, {
          organizationId: principal.organizationId,
          projectId: project.id,
          number,
          key: `${project.key}-${number}`,
          title: dto.title.trim(),
          description: dto.description ?? '',
          type: dto.type,
          status,
          priority: dto.priority,
          position,
          assigneeId: dto.assigneeId ?? null,
          reporterId: principal.userId,
          sprintId: dto.sprintId ?? null,
          storyPoints: dto.storyPoints ?? null,
          startDate: dto.startDate ?? null,
          dueDate: dto.dueDate ?? null,
          completedAt: status === TaskStatus.DONE ? new Date() : null,
        }),
      );
      return findTask(m, principal.organizationId, saved.id);
    });
    const dto$ = toTaskDto(task);
    const base = { organizationId: principal.organizationId, projectId: task.projectId, actor: actorOf(principal) };
    this.events.publish('TASK_CREATED', { ...base, data: { task: dto$ } });
    if (task.assigneeId) this.events.publish('TASK_ASSIGNED', { ...base, data: { task: dto$, previousAssigneeId: null } });
    return dto$;
  }

  async update(principal: AuthPrincipal, idOrKey: string, dto: UpdateTaskDto) {
    for (const [field, value] of Object.entries(dto)) {
      if (value === null && !NULLABLE.has(field)) throw ApiException.badRequest('VALIDATION_ERROR', `${field} cannot be null`);
    }
    const { task, changes, previousAssigneeId } = await this.dataSource.transaction(async (m) => {
      const task = await findTask(m, principal.organizationId, idOrKey);
      await this.validateRefs(m, principal.organizationId, task.projectId, dto);
      const changes: Record<string, FieldChange> = {};
      const previousAssigneeId = task.assigneeId;

      for (const field of EDITABLE) {
        const value = dto[field];
        if (value !== undefined && value !== task[field]) {
          changes[field] = { from: task[field], to: value };
          (task as any)[field] = value;
        }
      }
      // Drop the loaded relation so TypeORM persists the new assigneeId column value.
      if ('assigneeId' in changes) (task as any).assignee = undefined;

      if (dto.status && dto.status !== task.status) {
        await lockProject(m, task.projectId);
        changes.status = { from: task.status, to: dto.status };
        const from = task.status;
        task.status = dto.status;
        task.completedAt = dto.status === TaskStatus.DONE ? new Date() : null;
        task.position = await m.count(Task, { where: { projectId: task.projectId, status: dto.status } });
        await m.save(task);
        await reorderColumn(m, task.projectId, from, task);
      } else if (Object.keys(changes).length) {
        await m.save(task);
      }
      return { task: await findTask(m, principal.organizationId, task.id), changes, previousAssigneeId };
    });

    const dto$ = toTaskDto(task);
    if (Object.keys(changes).length) {
      const base = { organizationId: principal.organizationId, projectId: task.projectId, actor: actorOf(principal) };
      this.events.publish('TASK_UPDATED', { ...base, data: { task: dto$, changes } });
      if ('assigneeId' in changes && task.assigneeId) this.events.publish('TASK_ASSIGNED', { ...base, data: { task: dto$, previousAssigneeId } });
    }
    return dto$;
  }

  /** Drag & drop: move a task to `status` at `position`, re-ordering both columns. */
  async move(principal: AuthPrincipal, idOrKey: string, dto: MoveTaskDto) {
    const { task, changes } = await this.dataSource.transaction(async (m) => {
      const found = await findTask(m, principal.organizationId, idOrKey);
      await lockProject(m, found.projectId);
      const task = await findTask(m, principal.organizationId, found.id); // re-read under lock
      const from = { status: task.status, position: task.position };
      const changes: Record<string, FieldChange> = {};
      if (from.status !== dto.status) {
        changes.status = { from: from.status, to: dto.status };
        task.status = dto.status;
        task.completedAt = dto.status === TaskStatus.DONE ? new Date() : null;
      }
      await reorderColumn(m, task.projectId, dto.status, undefined, { task, index: dto.position });
      if (task.position !== from.position || changes.status) changes.position = { from: from.position, to: task.position };
      await m.save(task);
      if (changes.status) await reorderColumn(m, task.projectId, from.status, task);
      return { task: await findTask(m, principal.organizationId, task.id), changes };
    });
    const dto$ = toTaskDto(task);
    if (Object.keys(changes).length) {
      this.events.publish('TASK_UPDATED', {
        organizationId: principal.organizationId,
        projectId: task.projectId,
        actor: actorOf(principal),
        data: { task: dto$, changes, moved: true },
      });
    }
    return dto$;
  }

  async remove(principal: AuthPrincipal, idOrKey: string) {
    const task = await this.dataSource.transaction(async (m) => {
      const task = await findTask(m, principal.organizationId, idOrKey);
      await lockProject(m, task.projectId);
      await m.delete(Task, { id: task.id });
      await reorderColumn(m, task.projectId, task.status);
      return task;
    });
    this.events.publish('TASK_DELETED', {
      organizationId: principal.organizationId,
      projectId: task.projectId,
      actor: actorOf(principal),
      data: { task: toTaskDto(task) },
    });
    return { id: task.id, key: task.key, deleted: true };
  }

  private async validateRefs(m: EntityManager, orgId: string, projectId: string, dto: { assigneeId?: string | null; sprintId?: string | null }) {
    if (dto.assigneeId && !(await m.existsBy(Membership, { organizationId: orgId, userId: dto.assigneeId }))) {
      throw ApiException.badRequest('INVALID_ASSIGNEE', 'Assignee is not a member of this organization');
    }
    if (dto.sprintId) {
      const sprint = await m.findOneBy(Sprint, { id: dto.sprintId, projectId });
      if (!sprint) throw ApiException.badRequest('INVALID_SPRINT', 'Sprint does not belong to this project');
      if (sprint.status === SprintStatus.COMPLETED) throw ApiException.badRequest('SPRINT_COMPLETED', 'Cannot add tasks to a completed sprint');
    }
  }
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
