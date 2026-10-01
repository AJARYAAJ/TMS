import { Injectable } from '@nestjs/common';
import { Brackets, DataSource, EntityManager, In } from 'typeorm';
import { actorOf, AuthPrincipal } from '../../common/auth/principal';
import { FieldChange } from '../../common/events/domain-events';
import { EventBus } from '../../common/events/event-bus.service';
import { ApiResult, paginated } from '../../common/http/api-response';
import { ApiException } from '../../common/http/api-exception';
import { isUuid } from '../../common/http/identifiers';
import { applyFieldValues } from '../fields/field-values';
import { Label } from '../labels/label.entity';
import { Membership } from '../organizations/membership.entity';
import { findProject } from '../projects/projects.service';
import { Sprint, SprintStatus } from '../sprints/sprint.entity';
import { WorkflowState } from '../workflow/workflow-state.entity';
import { TaskLink, TaskLinkType } from './task-link.entity';
import { Task, TASK_STATUSES, TaskStatus } from './task.entity';
import { toStateDto } from '../workflow/workflow-state.entity';
import { AddLinkDto, CreateTaskDto, EMPTY_STATS, ListTasksQuery, MoveTaskDto, TaskDto, TaskStats, toTaskDto, UpdateTaskDto } from './tasks.dto';

const TASK_RELATIONS = { assignee: true, reporter: true, labels: true, parent: true, state: true } as const;
const NULLABLE = new Set(['assigneeId', 'sprintId', 'storyPoints', 'startDate', 'dueDate', 'parentId', 'estimateMinutes', 'recurrence']);
const EDITABLE = ['title', 'description', 'type', 'priority', 'assigneeId', 'sprintId', 'storyPoints', 'startDate', 'dueDate', 'parentId', 'estimateMinutes', 'recurrence'] as const;
const same = (a: unknown, b: unknown) => (a && typeof a === 'object') || (b && typeof b === 'object') ? JSON.stringify(a ?? null) === JSON.stringify(b ?? null) : a === b;

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
            (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id)::int AS "commentCount",
            (SELECT COUNT(*) FROM external_links x WHERE x.task_id = t.id AND x.kind = 'pull_request' AND x.state IN ('open', 'draft'))::int AS "openPrs"
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

/**
 * Picks the workflow state for a task: an explicit state (must belong to the project), else the
 * first state of the requested status category, else the project's first state.
 */
export async function resolveState(m: EntityManager, projectId: string, want: { stateId?: string | null; status?: TaskStatus | null }) {
  if (want.stateId) {
    const state = await m.findOneBy(WorkflowState, { id: want.stateId, projectId });
    if (!state) throw ApiException.badRequest('INVALID_STATE', 'Workflow state does not belong to this project');
    return state;
  }
  const states = await m.find(WorkflowState, { where: { projectId }, order: { position: 'ASC' } });
  if (!states.length) throw ApiException.badRequest('NO_WORKFLOW', 'This project has no workflow states');
  if (!want.status) return states[0];
  const match = states.find((st) => st.category === want.status);
  if (!match) throw ApiException.badRequest('NO_STATE_FOR_STATUS', `This project's workflow has no ${want.status.replace('_', ' ').toLowerCase()} state`);
  return match;
}

/** Where new tasks land: the first "to do" state, or the first state if the workflow has none. */
export async function defaultState(m: EntityManager, projectId: string) {
  const states = await m.find(WorkflowState, { where: { projectId }, order: { position: 'ASC' } });
  const state = states.find((st) => st.category === TaskStatus.TODO) ?? states[0];
  if (!state) throw ApiException.badRequest('NO_WORKFLOW', 'This project has no workflow states');
  return state;
}

/** Rewrites 0..n-1 positions for a workflow column, optionally inserting `insert` at `index`. */
async function reorderColumn(m: EntityManager, projectId: string, stateId: string, exclude?: Task, insert?: { task: Task; index: number }) {
  const column = await m.find(Task, { where: { projectId, stateId }, order: { position: 'ASC', createdAt: 'ASC' } });
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
      .leftJoinAndSelect('t.state', 'state')
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
    if (q.stateId) qb.andWhere('t.stateId = :stateId', { stateId: q.stateId });
    if (q.type) qb.andWhere('t.type = :type', { type: q.type });
    if (q.priority) qb.andWhere('t.priority = :priority', { priority: q.priority });
    if (q.open === 'true') qb.andWhere('t.status <> :done', { done: TaskStatus.DONE });
    if (q.open === 'false') qb.andWhere('t.status = :done', { done: TaskStatus.DONE });
    if (q.dueFrom) qb.andWhere('t.dueDate >= :dueFrom', { dueFrom: q.dueFrom });
    if (q.dueTo) qb.andWhere('t.dueDate <= :dueTo', { dueTo: q.dueTo });
    if (q.cf) {
      let filters: Record<string, unknown>;
      try {
        filters = JSON.parse(q.cf);
      } catch {
        throw ApiException.badRequest('VALIDATION_ERROR', 'cf must be a JSON object');
      }
      if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw ApiException.badRequest('VALIDATION_ERROR', 'cf must be a JSON object');
      Object.entries(filters).forEach(([fieldId, value], i) => {
        if (!isUuid(fieldId)) throw ApiException.badRequest('VALIDATION_ERROR', 'cf keys must be custom field ids');
        const k = `cfk${i}`;
        const v = `cfv${i}`;
        if (value === null) qb.andWhere(`NOT (t.custom_values ? :${k})`, { [k]: fieldId });
        else if (value === false) qb.andWhere(`COALESCE(t.custom_values -> :${k}, 'false'::jsonb) = 'false'::jsonb`, { [k]: fieldId });
        // jsonb containment: equal scalars match, and arrays (multi-select) match when they contain the value.
        else qb.andWhere(`(t.custom_values -> :${k}) @> CAST(:${v} AS jsonb)`, { [k]: fieldId, [v]: JSON.stringify(value) });
      });
    }
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
        qb.orderBy('state.position', 'ASC').addOrderBy('t.position', order);
    }
    qb.addOrderBy('t.number', 'ASC').skip((page - 1) * size).take(size);

    const [rows, total] = await qb.getManyAndCount();
    return paginated(await toTaskDtos(this.dataSource.manager, rows), page, size, total);
  }

  /** Task detail: the task plus watchers and dependency links. */
  async get(orgId: string, idOrKey: string) {
    const m = this.dataSource.manager;
    const task = await findTask(m, orgId, idOrKey);
    const [dto, watchers, links, devLinks] = await Promise.all([
      taskDto(m, task),
      this.watchers(task.id),
      this.links(task.id),
      m.query(
        `SELECT id, provider, kind, external_id AS "externalId", url, title, state, author, updated_at AS "updatedAt"
           FROM external_links WHERE task_id = $1 ORDER BY CASE kind WHEN 'pull_request' THEN 0 WHEN 'issue' THEN 1 ELSE 2 END, updated_at DESC`,
        [task.id],
      ),
    ]);
    return { ...dto, watchers, links, devLinks };
  }

  async board(orgId: string, projectIdOrKey: string, sprintId?: string) {
    const project = await findProject(this.dataSource.manager, orgId, projectIdOrKey);
    const where: Record<string, unknown> = { projectId: project.id };
    if (sprintId && isUuid(sprintId)) where.sprintId = sprintId;
    const [tasks, states] = await Promise.all([
      this.dataSource.getRepository(Task).find({ where, relations: TASK_RELATIONS, order: { position: 'ASC', number: 'ASC' } }),
      this.dataSource.getRepository(WorkflowState).find({ where: { projectId: project.id }, order: { position: 'ASC' } }),
    ]);
    const dtos = await toTaskDtos(this.dataSource.manager, tasks);
    return {
      projectId: project.id,
      // One column per workflow state; `status` is the state's category.
      columns: states.map((st) => ({ status: st.category, state: toStateDto(st), tasks: dtos.filter((t) => t.stateId === st.id) })),
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
      const state = dto.stateId || dto.status ? await resolveState(m, project.id, { stateId: dto.stateId, status: dto.status }) : await defaultState(m, project.id);
      const status = state.category;
      const position = await m.count(Task, { where: { projectId: project.id, stateId: state.id } });
      const { values: customValues } = await applyFieldValues(m, principal.organizationId, project.id, {}, dto.customFields ?? {});
      const entity = m.create(Task, {
        customValues: customValues as Task['customValues'],
        organizationId: principal.organizationId,
        projectId: project.id,
        number,
        key: `${project.key}-${number}`,
        title: dto.title.trim(),
        description: dto.description ?? '',
        type: dto.type,
        status,
        stateId: state.id,
        priority: dto.priority,
        position,
        recurrence: dto.recurrence ?? null,
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
        if (value !== undefined && !same(value, task[field])) {
          changes[field] = { from: task[field], to: value };
          (task as any)[field] = value;
        }
      }
      // Drop loaded relations whose FK column changed so TypeORM persists the new id.
      if ('assigneeId' in changes) (task as any).assignee = undefined;
      if ('parentId' in changes) (task as any).parent = undefined;

      if (dto.customFields) {
        const { values, changed } = await applyFieldValues(m, principal.organizationId, task.projectId, task.customValues ?? {}, dto.customFields);
        if (changed) {
          changes.customFields = changed;
          task.customValues = values as Task['customValues'];
        }
      }

      if (!dto.labelIds && (dto.addLabelIds?.length || dto.removeLabelIds?.length)) {
        const keep = task.labels.map((l) => l.id).filter((id) => !dto.removeLabelIds?.includes(id));
        dto = { ...dto, labelIds: [...new Set([...keep, ...(dto.addLabelIds ?? [])])] };
      }
      if (dto.labelIds) {
        const next = await this.loadLabels(m, principal.organizationId, dto.labelIds);
        const before = task.labels.map((l) => l.name).sort();
        const after = next.map((l) => l.name).sort();
        if (before.join() !== after.join()) {
          changes.labels = { from: before, to: after };
          task.labels = next;
        }
      }

      // A status (category) change keeps the task in its state if that state already matches.
      const wantsState = dto.stateId ? dto.stateId !== task.stateId : !!dto.status && dto.status !== task.state.category;
      if (wantsState) {
        await lockProject(m, task.projectId);
        const next = await resolveState(m, task.projectId, { stateId: dto.stateId, status: dto.status });
        const from = task.state;
        changes.state = { from: from.name, to: next.name };
        changes.stateId = { from: from.id, to: next.id };
        if (from.category !== next.category) changes.status = { from: from.category, to: next.category };
        (task as any).state = undefined;
        task.stateId = next.id;
        task.status = next.category;
        if (from.category !== next.category) task.completedAt = next.category === TaskStatus.DONE ? new Date() : null;
        task.position = await m.count(Task, { where: { projectId: task.projectId, stateId: next.id } });
        await m.save(task);
        await reorderColumn(m, task.projectId, from.id, task);
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
      if (!dto.stateId && !dto.status) throw ApiException.badRequest('VALIDATION_ERROR', 'Provide stateId or status');
      const fromState = task.state;
      const target = dto.stateId || dto.status !== fromState.category ? await resolveState(m, task.projectId, { stateId: dto.stateId, status: dto.status }) : fromState;
      const from = { stateId: fromState.id, position: task.position };
      const changes: Record<string, FieldChange> = {};
      if (target.id !== fromState.id) {
        changes.state = { from: fromState.name, to: target.name };
        changes.stateId = { from: fromState.id, to: target.id };
        if (target.category !== fromState.category) {
          changes.status = { from: fromState.category, to: target.category };
          task.completedAt = target.category === TaskStatus.DONE ? new Date() : null;
        }
        (task as any).state = undefined;
        task.stateId = target.id;
        task.status = target.category;
      }
      await reorderColumn(m, task.projectId, target.id, undefined, { task, index: dto.position });
      if (task.position !== from.position || changes.stateId) changes.position = { from: from.position, to: task.position };
      await m.save(task);
      if (changes.stateId) await reorderColumn(m, task.projectId, from.stateId, task);
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

  /** Moves a task (and its subtasks) to the trash. Trashed tasks disappear everywhere but can be restored. */
  async remove(principal: AuthPrincipal, idOrKey: string) {
    const { task, count } = await this.dataSource.transaction(async (m) => {
      const task = await findTask(m, principal.organizationId, idOrKey);
      await lockProject(m, task.projectId);
      const [rows]: [{ id: string; state_id: string }[], number] = await m.query(
        `WITH RECURSIVE tree(id) AS (SELECT $1::uuid UNION SELECT t.id FROM tasks t JOIN tree ON t.parent_id = tree.id)
         UPDATE tasks_all SET deleted_at = now(), deleted_by_id = $2 WHERE id IN (SELECT id FROM tree) RETURNING id, state_id`,
        [task.id, principal.userId],
      );
      for (const stateId of new Set(rows.map((r) => r.state_id))) await reorderColumn(m, task.projectId, stateId);
      return { task, count: rows.length };
    });
    this.events.publish('TASK_DELETED', {
      organizationId: principal.organizationId,
      projectId: task.projectId,
      actor: actorOf(principal),
      data: { task: toTaskDto(task), trashed: true, count },
    });
    return { id: task.id, key: task.key, deleted: true, trashed: true, count };
  }

  /* ─────────── Trash ─────────── */

  /** Trashed tasks, newest first. Subtasks trashed together with their parent are folded into it. */
  async trash(orgId: string, projectIdOrKey?: string) {
    const project = projectIdOrKey ? await findProject(this.dataSource.manager, orgId, projectIdOrKey) : null;
    return this.dataSource.query(
      `SELECT t.id, t.key, t.title, t.type, t.status, t.project_id AS "projectId", p.key AS "projectKey", p.name AS "projectName",
              t.deleted_at AS "deletedAt", json_build_object('id', u.id, 'name', u.name) AS "deletedBy",
              (SELECT COUNT(*) FROM tasks_all c WHERE c.parent_id = t.id AND c.deleted_at = t.deleted_at)::int AS "subtaskCount",
              (t.deleted_at + interval '30 days') AS "purgeAt"
         FROM tasks_all t
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN users u ON u.id = t.deleted_by_id
        WHERE t.organization_id = $1 AND t.deleted_at IS NOT NULL AND ($2::uuid IS NULL OR t.project_id = $2)
          AND NOT EXISTS (SELECT 1 FROM tasks_all par WHERE par.id = t.parent_id AND par.deleted_at = t.deleted_at)
        ORDER BY t.deleted_at DESC, t.number
        LIMIT 200`,
      [orgId, project?.id ?? null],
    );
  }

  /** Restores a trashed task together with the subtasks that were trashed with it. */
  async restore(principal: AuthPrincipal, id: string) {
    const task = await this.dataSource.transaction(async (m) => {
      const [row] = await m.query(`SELECT id, project_id, parent_id, deleted_at FROM tasks_all WHERE id = $1 AND organization_id = $2 AND deleted_at IS NOT NULL`, [id, principal.organizationId]);
      if (!row) throw ApiException.notFound('task', 'That task is not in the trash');
      await lockProject(m, row.project_id);
      const batch: { id: string }[] = await m.query(
        // Compared in SQL: timestamps are microsecond-precise in Postgres but only millisecond-precise in JS.
        `WITH RECURSIVE tree(id) AS (
           SELECT $1::uuid
           UNION SELECT c.id FROM tasks_all c JOIN tree ON c.parent_id = tree.id WHERE c.deleted_at = (SELECT deleted_at FROM tasks_all WHERE id = $1)
         ) SELECT id FROM tree`,
        [row.id],
      );
      const ids = batch.map((b) => b.id);
      // A parent that is still in the trash can't hold the restored task; it comes back top-level.
      await m.query(`UPDATE tasks_all SET parent_id = NULL WHERE id = $1 AND parent_id IN (SELECT id FROM tasks_all WHERE deleted_at IS NOT NULL)`, [row.id]);
      await m.query(`UPDATE tasks_all SET sprint_id = NULL WHERE id = ANY($1) AND sprint_id IN (SELECT id FROM sprints WHERE status = 'COMPLETED')`, [ids]);
      const [restored]: [{ state_id: string }[], number] = await m.query(`UPDATE tasks_all SET deleted_at = NULL, deleted_by_id = NULL WHERE id = ANY($1) RETURNING state_id`, [ids]);
      for (const stateId of new Set(restored.map((r) => r.state_id))) await reorderColumn(m, row.project_id, stateId);
      return findTask(m, principal.organizationId, row.id);
    });
    const dto$ = await taskDto(this.dataSource.manager, task);
    this.events.publish('TASK_RESTORED', { organizationId: principal.organizationId, projectId: task.projectId, actor: actorOf(principal), data: { task: dto$ } });
    return dto$;
  }

  /** Permanently deletes a trashed task and its trashed subtasks (comments, time and files go too). */
  async purge(principal: AuthPrincipal, id: string) {
    const [row] = await this.dataSource.query(`SELECT id, key, deleted_at FROM tasks_all WHERE id = $1 AND organization_id = $2 AND deleted_at IS NOT NULL`, [id, principal.organizationId]);
    if (!row) throw ApiException.notFound('task', 'That task is not in the trash');
    const [, count] = await this.dataSource.query(
      `WITH RECURSIVE tree(id) AS (
         SELECT $1::uuid
         UNION SELECT c.id FROM tasks_all c JOIN tree ON c.parent_id = tree.id WHERE c.deleted_at = (SELECT deleted_at FROM tasks_all WHERE id = $1)
       ) DELETE FROM tasks_all WHERE id IN (SELECT id FROM tree)`,
      [row.id],
    );
    return { id: row.id, key: row.key, purged: true, count };
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
    // A linked task in the trash is loaded as null (tasks is a view of live rows); hide that link until it is restored.
    return rows.filter((l) => l.source && l.target).map((l) => {
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
