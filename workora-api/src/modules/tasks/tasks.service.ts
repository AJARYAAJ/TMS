import { Injectable } from '@nestjs/common';
import { Brackets, DataSource, EntityManager, In } from 'typeorm';
import { actorOf, AuthPrincipal } from '../../common/auth/principal';
import { FieldChange } from '../../common/events/domain-events';
import { EventBus } from '../../common/events/event-bus.service';
import { ApiResult, paginated } from '../../common/http/api-response';
import { ApiException } from '../../common/http/api-exception';
import { isUuid } from '../../common/http/identifiers';
import { Label } from '../labels/label.entity';
import { Membership } from '../organizations/membership.entity';
import { findProject } from '../projects/projects.service';
import { Sprint, SprintStatus } from '../sprints/sprint.entity';
import { TaskLink, TaskLinkType } from './task-link.entity';
import { Task, TASK_STATUSES, TaskStatus } from './task.entity';
import { AddLinkDto, CreateTaskDto, EMPTY_STATS, ListTasksQuery, MoveTaskDto, TaskDto, TaskStats, toTaskDto, UpdateTaskDto } from './tasks.dto';

const TASK_RELATIONS = { assignee: true, reporter: true, labels: true, parent: true } as const;
const NULLABLE = new Set(['assigneeId', 'sprintId', 'storyPoints', 'startDate', 'dueDate', 'parentId', 'estimateMinutes']);
const EDITABLE = ['title', 'description', 'type', 'priority', 'assigneeId', 'sprintId', 'storyPoints', 'startDate', 'dueDate', 'parentId', 'estimateMinutes'] as const;

/** Resolve a task by UUID or human key (ECOM-102) within the tenant. */
export async function findTask(m: EntityManager, orgId: string, idOrKey: string) {
  const where = isUuid(idOrKey) ? { id: idOrKey, organizationId: orgId } : { key: idOrKey.toUpperCase(), organizationId: orgId };
  const task = await m.findOne(Task, { where, relations: TASK_RELATIONS });
  if (!task) throw ApiException.notFound('task');
  return task;
}

/** Subtask progress, open blockers, logged time and comment count for a batch of tasks (one query). */
export async function loadTaskStats(m: EntityManager, ids: string[]): Promise<Map<string, TaskStats>> {
  if (!ids.length) return new Map();
  const rows: (TaskStats & { id: string })[] = await m.query(
    `SELECT t.id,
            (SELECT COUNT(*) FROM tasks c WHERE c.parent_id = t.id)::int AS "subtaskCount",
            (SELECT COUNT(*) FROM tasks c WHERE c.parent_id = t.id AND c.status = 'DONE')::int AS "subtaskDone",
            (SELECT COUNT(*) FROM task_links l JOIN tasks s ON s.id = l.source_task_id
              WHERE l.target_task_id = t.id AND l.type = 'BLOCKS' AND s.status <> 'DONE')::int AS "blockedBy",
            (SELECT COALESCE(SUM(e.minutes), 0) FROM time_entries e WHERE e.task_id = t.id)::int AS "loggedMinutes",
            (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id)::int AS "commentCount"
       FROM tasks t WHERE t.id = ANY($1)`,
    [ids],
  );
  return new Map(rows.map(({ id, ...s }) => [id, s]));
}

export async function toTaskDtos(m: EntityManager, tasks: Task[]) {
  const stats = await loadTaskStats(m, tasks.map((t) => t.id));
  return tasks.map((t) => toTaskDto(t, stats.get(t.id) ?? EMPTY_STATS));
}

export async function taskDto(m: EntityManager, task: Task) {
  return (await toTaskDtos(m, [task]))[0];
}

export async function addWatchers(m: EntityManager, taskId: string, userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  await m.query(`INSERT INTO task_watchers (task_id, user_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`, [taskId, ids]);
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
  for (const [i, t] of ordered.entries()) {
    if (t === insert?.task) t.position = i;
    else if (t.position !== i) await m.update(Task, { id: t.id }, { position: i });
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
      .leftJoinAndSelect('t.labels', 'labels')
      .leftJoinAndSelect('t.parent', 'parent')
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
    if (q.parentId === 'none') qb.andWhere('t.parentId IS NULL');
    else if (q.parentId) qb.andWhere('t.parentId = :parentId', { parentId: q.parentId });
    if (q.labelId) qb.andWhere('t.id IN (SELECT tl.task_id FROM task_labels tl WHERE tl.label_id = :labelId)', { labelId: q.labelId });
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
    return paginated(await toTaskDtos(this.dataSource.manager, rows), page, size, total);
  }

  /** Task detail: the task plus watchers and dependency links. */
  async get(orgId: string, idOrKey: string) {
    const m = this.dataSource.manager;
    const task = await findTask(m, orgId, idOrKey);
    const [dto, watchers, links] = await Promise.all([taskDto(m, task), this.watchers(task.id), this.links(task.id)]);
    return { ...dto, watchers, links };
  }

  async board(orgId: string, projectIdOrKey: string, sprintId?: string) {
    const project = await findProject(this.dataSource.manager, orgId, projectIdOrKey);
    const where: Record<string, unknown> = { projectId: project.id };
    if (sprintId && isUuid(sprintId)) where.sprintId = sprintId;
    const tasks = await this.dataSource.getRepository(Task).find({ where, relations: TASK_RELATIONS, order: { position: 'ASC', number: 'ASC' } });
    const dtos = await toTaskDtos(this.dataSource.manager, tasks);
    return {
      projectId: project.id,
      columns: TASK_STATUSES.map((status) => ({ status, tasks: dtos.filter((t) => t.status === status) })),
    };
  }

  async subtasks(orgId: string, idOrKey: string) {
    const m = this.dataSource.manager;
    const task = await findTask(m, orgId, idOrKey);
    const children = await m.find(Task, { where: { parentId: task.id }, relations: TASK_RELATIONS, order: { number: 'ASC' } });
    return toTaskDtos(m, children);
  }

  async create(principal: AuthPrincipal, dto: CreateTaskDto) {
    const task = await this.dataSource.transaction(async (m) => {
      const project = await findProject(m, principal.organizationId, dto.projectId);
      await this.validateRefs(m, principal.organizationId, project.id, dto);
      await lockProject(m, project.id);
      const number = await nextTaskNumber(m, project.id);
      const status = dto.status ?? TaskStatus.TODO;
      const position = await m.count(Task, { where: { projectId: project.id, status } });
      const entity = m.create(Task, {
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
        parentId: dto.parentId ?? null,
        storyPoints: dto.storyPoints ?? null,
        estimateMinutes: dto.estimateMinutes ?? null,
        startDate: dto.startDate ?? null,
        dueDate: dto.dueDate ?? null,
        completedAt: status === TaskStatus.DONE ? new Date() : null,
      });
      if (dto.labelIds?.length) entity.labels = await this.loadLabels(m, principal.organizationId, dto.labelIds);
      const saved = await m.save(entity);
      await addWatchers(m, saved.id, [principal.userId, dto.assigneeId]);
      return findTask(m, principal.organizationId, saved.id);
    });
    const dto$ = await taskDto(this.dataSource.manager, task);
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
      await this.validateRefs(m, principal.organizationId, task.projectId, dto, task.id);
      const changes: Record<string, FieldChange> = {};
      const previousAssigneeId = task.assigneeId;

      for (const field of EDITABLE) {
        const value = dto[field];
        if (value !== undefined && value !== task[field]) {
          changes[field] = { from: task[field], to: value };
          (task as any)[field] = value;
        }
      }
      // Drop loaded relations whose FK column changed so TypeORM persists the new id.
      if ('assigneeId' in changes) (task as any).assignee = undefined;
      if ('parentId' in changes) (task as any).parent = undefined;

      if (dto.labelIds) {
        const next = await this.loadLabels(m, principal.organizationId, dto.labelIds);
        const before = task.labels.map((l) => l.name).sort();
        const after = next.map((l) => l.name).sort();
        if (before.join() !== after.join()) {
          changes.labels = { from: before, to: after };
          task.labels = next;
        }
      }

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
      if ('dueDate' in changes) await m.update(Task, { id: task.id }, { overdueNotifiedAt: null });
      if ('assigneeId' in changes) await addWatchers(m, task.id, [task.assigneeId]);
      return { task: await findTask(m, principal.organizationId, task.id), changes, previousAssigneeId };
    });

    const dto$ = await taskDto(this.dataSource.manager, task);
    if (Object.keys(changes).length) {
      const base = { organizationId: principal.organizationId, projectId: task.projectId, actor: actorOf(principal) };
      this.events.publish('TASK_UPDATED', { ...base, data: { task: dto$, changes } });
      if ('assigneeId' in changes && task.assigneeId) this.events.publish('TASK_ASSIGNED', { ...base, data: { task: dto$, previousAssigneeId } });
    }
    return dto$;
  }

  /** Apply the same patch to many tasks (list multi-select). Each task emits its own events. */
  async bulkUpdate(principal: AuthPrincipal, ids: string[], patch: UpdateTaskDto) {
    const updated: TaskDto[] = [];
    const failed: { id: string; code: string; message: string }[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        updated.push(await this.update(principal, id, patch));
      } catch (e: any) {
        failed.push({ id, code: e?.code ?? 'ERROR', message: e?.message ?? 'Failed' });
      }
    }
    return { updated, failed };
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
    const dto$ = await taskDto(this.dataSource.manager, task);
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

  /* ─────────── Watchers ─────────── */

  async watchers(taskId: string) {
    const rows = await this.dataSource.query(
      `SELECT u.id, u.name, u.email FROM task_watchers w JOIN users u ON u.id = w.user_id WHERE w.task_id = $1 ORDER BY w.created_at`,
      [taskId],
    );
    return rows as { id: string; name: string; email: string }[];
  }

  async watch(principal: AuthPrincipal, idOrKey: string, userId = principal.userId) {
    const m = this.dataSource.manager;
    const task = await findTask(m, principal.organizationId, idOrKey);
    if (!(await m.existsBy(Membership, { organizationId: principal.organizationId, userId }))) throw ApiException.notFound('user');
    await addWatchers(m, task.id, [userId]);
    return this.watchers(task.id);
  }

  async unwatch(principal: AuthPrincipal, idOrKey: string, userId = principal.userId) {
    const task = await findTask(this.dataSource.manager, principal.organizationId, idOrKey);
    await this.dataSource.query('DELETE FROM task_watchers WHERE task_id = $1 AND user_id = $2', [task.id, userId]);
    return this.watchers(task.id);
  }

  /* ─────────── Dependencies / links ─────────── */

  async links(taskId: string) {
    const rows = await this.dataSource.getRepository(TaskLink).find({
      where: [{ sourceTaskId: taskId }, { targetTaskId: taskId }],
      relations: { source: true, target: true },
      order: { createdAt: 'ASC' },
    });
    return rows.map((l) => {
      const outgoing = l.sourceTaskId === taskId;
      const other = outgoing ? l.target : l.source;
      return {
        id: l.id,
        type: l.type,
        /** Human phrasing from this task's point of view. */
        relation: l.type === TaskLinkType.BLOCKS ? (outgoing ? 'blocks' : 'blocked by') : l.type === TaskLinkType.DUPLICATES ? (outgoing ? 'duplicates' : 'duplicated by') : 'relates to',
        direction: outgoing ? 'outgoing' : 'incoming',
        task: { id: other.id, key: other.key, title: other.title, status: other.status, projectId: other.projectId },
      };
    });
  }

  async addLink(principal: AuthPrincipal, idOrKey: string, dto: AddLinkDto) {
    const m = this.dataSource.manager;
    const task = await findTask(m, principal.organizationId, idOrKey);
    const other = await findTask(m, principal.organizationId, dto.targetId);
    if (other.id === task.id) throw ApiException.badRequest('INVALID_LINK', 'A task cannot link to itself');
    const [source, target] = dto.direction === 'incoming' ? [other, task] : [task, other];
    if (dto.type === TaskLinkType.BLOCKS && (await this.reaches(target.id, source.id))) {
      throw ApiException.badRequest('DEPENDENCY_CYCLE', `${target.key} already blocks ${source.key} (directly or indirectly)`);
    }
    const repo = m.getRepository(TaskLink);
    if (await repo.existsBy({ sourceTaskId: source.id, targetTaskId: target.id, type: dto.type })) throw ApiException.conflict('LINK_EXISTS', 'These tasks are already linked');
    await repo.save(repo.create({ organizationId: principal.organizationId, sourceTaskId: source.id, targetTaskId: target.id, type: dto.type, createdById: principal.userId }));
    const dto$ = await taskDto(m, task);
    this.events.publish('TASK_LINKED', {
      organizationId: principal.organizationId,
      projectId: task.projectId,
      actor: actorOf(principal),
      data: { task: dto$, link: { type: dto.type, source: source.key, target: target.key } },
    });
    return this.links(task.id);
  }

  async removeLink(principal: AuthPrincipal, idOrKey: string, linkId: string) {
    const task = await findTask(this.dataSource.manager, principal.organizationId, idOrKey);
    await this.dataSource.query('DELETE FROM task_links WHERE id = $1 AND (source_task_id = $2 OR target_task_id = $2)', [linkId, task.id]);
    return this.links(task.id);
  }

  /** True if `from` blocks `to` through a chain of BLOCKS links. */
  private async reaches(from: string, to: string) {
    const [row] = await this.dataSource.query(
      `WITH RECURSIVE chain(id) AS (
         SELECT target_task_id FROM task_links WHERE source_task_id = $1 AND type = 'BLOCKS'
         UNION
         SELECT l.target_task_id FROM task_links l JOIN chain c ON l.source_task_id = c.id WHERE l.type = 'BLOCKS'
       ) SELECT EXISTS (SELECT 1 FROM chain WHERE id = $2) AS found`,
      [from, to],
    );
    return !!row?.found;
  }

  /* ─────────── Helpers ─────────── */

  private async loadLabels(m: EntityManager, orgId: string, ids: string[]) {
    if (!ids.length) return [];
    const labels = await m.findBy(Label, { id: In(ids), organizationId: orgId });
    if (labels.length !== new Set(ids).size) throw ApiException.badRequest('INVALID_LABEL', 'One or more labels do not exist');
    return labels;
  }

  private async validateRefs(
    m: EntityManager,
    orgId: string,
    projectId: string,
    dto: { assigneeId?: string | null; sprintId?: string | null; parentId?: string | null },
    selfId?: string,
  ) {
    if (dto.assigneeId && !(await m.existsBy(Membership, { organizationId: orgId, userId: dto.assigneeId }))) {
      throw ApiException.badRequest('INVALID_ASSIGNEE', 'Assignee is not a member of this organization');
    }
    if (dto.sprintId) {
      const sprint = await m.findOneBy(Sprint, { id: dto.sprintId, projectId });
      if (!sprint) throw ApiException.badRequest('INVALID_SPRINT', 'Sprint does not belong to this project');
      if (sprint.status === SprintStatus.COMPLETED) throw ApiException.badRequest('SPRINT_COMPLETED', 'Cannot add tasks to a completed sprint');
    }
    if (dto.parentId) {
      const parent = await m.findOneBy(Task, { id: dto.parentId, organizationId: orgId });
      if (!parent || parent.projectId !== projectId) throw ApiException.badRequest('INVALID_PARENT', 'Parent must be a task in the same project');
      // Walk up the ancestors so a task can never become its own ancestor.
      let cursor: Task | null = parent;
      for (let depth = 0; cursor; depth++) {
        if (cursor.id === selfId) throw ApiException.badRequest('INVALID_PARENT', 'A task cannot be nested under itself or its subtasks');
        if (depth > 20) break;
        cursor = cursor.parentId ? await m.findOneBy(Task, { id: cursor.parentId }) : null;
      }
    }
  }
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
