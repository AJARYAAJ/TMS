import { Body, Controller, Delete, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsEnum, IsHexColor, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { CurrentUser, MinRole } from '../../common/auth/decorators';
import { actorOf, AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { EventBus } from '../../common/events/event-bus.service';
import { ApiException } from '../../common/http/api-exception';
import { isUuid } from '../../common/http/identifiers';
import { findProject } from '../projects/projects.service';
import { TaskStatus } from '../tasks/task.entity';
import { toStateDto, WorkflowState } from './workflow-state.entity';

class CreateStateDto {
  @IsString() @MinLength(1) @MaxLength(40) name: string;
  @IsEnum(TaskStatus) category: TaskStatus;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsInt() @Min(1) @Max(999) wipLimit?: number | null;
  /** Insert at this index (default: end). */
  @IsOptional() @IsInt() @Min(0) position?: number;
}

class UpdateStateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) name?: string;
  @IsOptional() @IsEnum(TaskStatus) category?: TaskStatus;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsInt() @Min(1) @Max(999) wipLimit?: number | null;
}

class ReorderDto {
  @IsArray() @ArrayMaxSize(30) @IsUUID('all', { each: true }) stateIds: string[];
}

const CATEGORY_COLORS: Record<TaskStatus, string> = { TODO: '#9a968b', IN_PROGRESS: '#3b82f6', IN_REVIEW: '#a855f7', DONE: '#16a34a' };

/**
 * Per-project workflows. States are the board columns; each belongs to a status category
 * (to do / in progress / in review / done), so reports, sprints and automations keep working
 * no matter how a team names or orders its columns.
 */
@Injectable()
export class WorkflowService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  async list(orgId: string, projectIdOrKey: string) {
    const project = await findProject(this.dataSource.manager, orgId, projectIdOrKey);
    return this.states(this.dataSource.manager, project.id);
  }

  async create(u: AuthPrincipal, projectIdOrKey: string, dto: CreateStateDto) {
    const project = await findProject(this.dataSource.manager, u.organizationId, projectIdOrKey);
    await this.dataSource.transaction(async (m) => {
      await this.assertUniqueName(m, project.id, dto.name);
      const states = await m.find(WorkflowState, { where: { projectId: project.id }, order: { position: 'ASC' } });
      if (states.length >= 30) throw ApiException.badRequest('TOO_MANY_STATES', 'A workflow can have at most 30 states');
      const index = Math.min(dto.position ?? states.length, states.length);
      const created = m.create(WorkflowState, {
        organizationId: u.organizationId,
        projectId: project.id,
        name: dto.name.trim(),
        category: dto.category,
        color: dto.color ?? CATEGORY_COLORS[dto.category],
        wipLimit: dto.wipLimit ?? null,
      });
      states.splice(index, 0, created);
      states.forEach((st, i) => (st.position = i));
      await m.save(states);
    });
    return this.changed(u, project.id);
  }

  async update(u: AuthPrincipal, id: string, dto: UpdateStateDto) {
    const state = await this.find(u.organizationId, id);
    await this.dataSource.transaction(async (m) => {
      if (dto.name && dto.name.trim().toLowerCase() !== state.name.toLowerCase()) await this.assertUniqueName(m, state.projectId, dto.name);
      if (dto.category && dto.category !== state.category) {
        // Keep every task's status (and completion time) consistent with its state's category.
        await m.query(
          `UPDATE tasks SET status = $2::varchar,
                  completed_at = CASE WHEN $2::varchar = 'DONE' THEN COALESCE(completed_at, now()) ELSE NULL END,
                  updated_at = now()
            WHERE state_id = $1`,
          [state.id, dto.category],
        );
      }
      if (dto.name) state.name = dto.name.trim();
      if (dto.category) state.category = dto.category;
      if (dto.color) state.color = dto.color;
      if (dto.wipLimit !== undefined) state.wipLimit = dto.wipLimit;
      await m.save(state);
    });
    return this.changed(u, state.projectId);
  }

  async reorder(u: AuthPrincipal, projectIdOrKey: string, stateIds: string[]) {
    const project = await findProject(this.dataSource.manager, u.organizationId, projectIdOrKey);
    await this.dataSource.transaction(async (m) => {
      const states = await m.find(WorkflowState, { where: { projectId: project.id } });
      const ids = new Set(states.map((st) => st.id));
      if (stateIds.length !== states.length || stateIds.some((sid) => !ids.has(sid)) || new Set(stateIds).size !== stateIds.length) {
        throw ApiException.badRequest('INVALID_ORDER', 'stateIds must list every state of the project exactly once');
      }
      for (const [i, sid] of stateIds.entries()) await m.update(WorkflowState, { id: sid }, { position: i });
    });
    return this.changed(u, project.id);
  }

  /** Deletes a state; its tasks move to `moveTo` (required when the state is not empty). */
  async remove(u: AuthPrincipal, id: string, moveTo?: string) {
    const state = await this.find(u.organizationId, id);
    await this.dataSource.transaction(async (m) => {
      await m.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [state.projectId]);
      const count = await m.count(WorkflowState, { where: { projectId: state.projectId } });
      if (count <= 1) throw ApiException.badRequest('LAST_STATE', 'A workflow needs at least one state');
      const [{ n }] = await m.query('SELECT COUNT(*)::int AS n FROM tasks WHERE state_id = $1', [state.id]);
      if (n > 0) {
        if (!moveTo) throw ApiException.badRequest('STATE_NOT_EMPTY', `Move its ${n} task(s) to another state first`, { taskCount: n });
        if (!isUuid(moveTo)) throw ApiException.badRequest('INVALID_STATE', 'moveTo must be a state id');
        const target = await m.findOneBy(WorkflowState, { id: moveTo, projectId: state.projectId });
        if (!target || target.id === state.id) throw ApiException.badRequest('INVALID_STATE', 'moveTo must be another state in the same project');
        await m.query(
          `WITH base AS (SELECT COUNT(*)::int AS c FROM tasks WHERE state_id = $2::uuid),
                moved AS (SELECT id, ROW_NUMBER() OVER (ORDER BY position, created_at) - 1 AS rn FROM tasks WHERE state_id = $1)
           UPDATE tasks t SET state_id = $2::uuid, status = $3::varchar, position = (SELECT c FROM base) + moved.rn,
                  completed_at = CASE WHEN $3::varchar = 'DONE' THEN COALESCE(t.completed_at, now()) ELSE NULL END, updated_at = now()
             FROM moved WHERE t.id = moved.id`,
          [state.id, target.id, target.category],
        );
      }
      // Trashed tasks (not visible through the tasks view) follow the live ones, so restoring them later works.
      const [fallback] = moveTo && isUuid(moveTo) ? [{ id: moveTo }] : await m.query('SELECT id FROM workflow_states WHERE project_id = $1 AND id <> $2 ORDER BY position LIMIT 1', [state.projectId, state.id]);
      await m.query(
        `UPDATE tasks_all SET state_id = $2::uuid, status = (SELECT category FROM workflow_states WHERE id = $2::uuid) WHERE state_id = $1 AND deleted_at IS NOT NULL`,
        [state.id, fallback.id],
      );
      await m.delete(WorkflowState, { id: state.id });
      const rest = await m.find(WorkflowState, { where: { projectId: state.projectId }, order: { position: 'ASC' } });
      for (const [i, st] of rest.entries()) if (st.position !== i) await m.update(WorkflowState, { id: st.id }, { position: i });
    });
    return this.changed(u, state.projectId);
  }

  private async states(m: EntityManager, projectId: string) {
    const rows = await m.find(WorkflowState, { where: { projectId }, order: { position: 'ASC' } });
    const counts: { state_id: string; n: number }[] = await m.query('SELECT state_id, COUNT(*)::int AS n FROM tasks WHERE project_id = $1 GROUP BY state_id', [projectId]);
    const byId = new Map(counts.map((c) => [c.state_id, c.n]));
    return rows.map((st) => ({ ...toStateDto(st), taskCount: byId.get(st.id) ?? 0 }));
  }

  private async changed(u: AuthPrincipal, projectId: string) {
    const states = await this.states(this.dataSource.manager, projectId);
    this.events.publish('WORKFLOW_UPDATED', { organizationId: u.organizationId, projectId, actor: actorOf(u), data: { states } });
    return states;
  }

  private async find(orgId: string, id: string) {
    const state = await this.dataSource.getRepository(WorkflowState).findOneBy({ id, organizationId: orgId });
    if (!state) throw ApiException.notFound('workflow_state');
    return state;
  }

  private async assertUniqueName(m: EntityManager, projectId: string, name: string) {
    const [row] = await m.query('SELECT 1 FROM workflow_states WHERE project_id = $1 AND lower(name) = lower($2)', [projectId, name.trim()]);
    if (row) throw ApiException.conflict('STATE_EXISTS', `A state named "${name.trim()}" already exists`);
  }
}

@ApiTags('workflows')
@ApiBearerAuth()
@Controller()
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  @Get('projects/:projectId/workflow')
  list(@CurrentUser() u: AuthPrincipal, @Param('projectId') projectId: string) {
    return this.workflow.list(u.organizationId, projectId);
  }

  @MinRole(Role.ADMIN)
  @Post('projects/:projectId/workflow/states')
  create(@CurrentUser() u: AuthPrincipal, @Param('projectId') projectId: string, @Body() dto: CreateStateDto) {
    return this.workflow.create(u, projectId, dto);
  }

  @MinRole(Role.ADMIN)
  @Patch('projects/:projectId/workflow/order')
  reorder(@CurrentUser() u: AuthPrincipal, @Param('projectId') projectId: string, @Body() dto: ReorderDto) {
    return this.workflow.reorder(u, projectId, dto.stateIds);
  }

  @MinRole(Role.ADMIN)
  @Patch('workflow-states/:id')
  update(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStateDto) {
    return this.workflow.update(u, id, dto);
  }

  @MinRole(Role.ADMIN)
  @Delete('workflow-states/:id')
  remove(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Query('moveTo') moveTo?: string) {
    return this.workflow.remove(u, id, moveTo);
  }
}

@Module({ controllers: [WorkflowController], providers: [WorkflowService], exports: [WorkflowService] })
export class WorkflowModule {}
