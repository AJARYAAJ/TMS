import { Body, Controller, Delete, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { CurrentUser, MinRole } from '../../common/auth/decorators';
import { actorOf, AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { EventBus } from '../../common/events/event-bus.service';
import { ApiException } from '../../common/http/api-exception';
import { Membership } from '../organizations/membership.entity';
import { findProject } from '../projects/projects.service';
import { findTask } from '../tasks/tasks.service';
import { TaskStatus } from '../tasks/task.entity';
import { toUserSummary } from '../users/user.entity';
import { Goal, GoalStatus, KeyResult, KeyResultKind } from './goal.entity';

class CreateGoalDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() projectId?: string | null;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsDateString() dueDate?: string | null;
}

class UpdateGoalDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsEnum(GoalStatus) status?: GoalStatus;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsDateString() dueDate?: string | null;
}

class KeyResultDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsOptional() @IsEnum(KeyResultKind) kind?: KeyResultKind;
  @IsOptional() @IsNumber() startValue?: number;
  @IsOptional() @IsNumber() targetValue?: number;
  @IsOptional() @IsNumber() currentValue?: number;
  @IsOptional() @IsString() @MaxLength(20) unit?: string;
}

class UpdateKeyResultDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsNumber() startValue?: number;
  @IsOptional() @IsNumber() targetValue?: number;
  @IsOptional() @IsNumber() currentValue?: number;
  @IsOptional() @IsString() @MaxLength(20) unit?: string;
}

class LinkTaskDto {
  @IsString() taskId: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Goals / OKRs: objectives with measurable key results and linked tasks. */
@Injectable()
export class GoalsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  private toDto(g: Goal) {
    const tasks = g.tasks ?? [];
    const done = tasks.filter((t) => t.status === TaskStatus.DONE).length;
    const taskProgress = tasks.length ? (done / tasks.length) * 100 : 0;
    const keyResults = (g.keyResults ?? [])
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((kr) => {
        const progress =
          kr.kind === KeyResultKind.TASKS
            ? clamp(taskProgress)
            : kr.targetValue === kr.startValue
              ? kr.currentValue >= kr.targetValue ? 100 : 0
              : clamp(((kr.currentValue - kr.startValue) / (kr.targetValue - kr.startValue)) * 100);
        const current = kr.kind === KeyResultKind.TASKS ? done : kr.currentValue;
        const target = kr.kind === KeyResultKind.TASKS ? tasks.length : kr.targetValue;
        return { id: kr.id, title: kr.title, kind: kr.kind, startValue: kr.startValue, targetValue: target, currentValue: current, unit: kr.unit, progress };
      });
    const progress = keyResults.length ? clamp(keyResults.reduce((n, k) => n + k.progress, 0) / keyResults.length) : clamp(taskProgress);
    return {
      id: g.id,
      title: g.title,
      description: g.description,
      status: g.status,
      dueDate: g.dueDate,
      owner: toUserSummary(g.owner),
      project: g.project ? { id: g.project.id, key: g.project.key, name: g.project.name, color: g.project.color } : null,
      progress,
      keyResults,
      tasks: tasks.map((t) => ({ id: t.id, key: t.key, title: t.title, status: t.status })),
      taskCount: tasks.length,
      tasksDone: done,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    };
  }

  private load(orgId: string, id: string) {
    return this.dataSource
      .getRepository(Goal)
      .findOne({ where: { id, organizationId: orgId }, relations: { owner: true, project: true, keyResults: true, tasks: true } })
      .then((g) => {
        if (!g) throw ApiException.notFound('goal');
        return g;
      });
  }

  async list(orgId: string, projectId?: string) {
    const project = projectId ? await findProject(this.dataSource.manager, orgId, projectId) : null;
    const goals = await this.dataSource.getRepository(Goal).find({
      where: { organizationId: orgId, ...(project ? { projectId: project.id } : {}) },
      relations: { owner: true, project: true, keyResults: true, tasks: true },
      order: { createdAt: 'DESC' },
    });
    return goals.map((g) => this.toDto(g));
  }

  async get(orgId: string, id: string) {
    return this.toDto(await this.load(orgId, id));
  }

  async create(u: AuthPrincipal, dto: CreateGoalDto) {
    const project = dto.projectId ? await findProject(this.dataSource.manager, u.organizationId, dto.projectId) : null;
    const ownerId = dto.ownerId ?? u.userId;
    await this.assertMember(u.organizationId, ownerId);
    const repo = this.dataSource.getRepository(Goal);
    const goal = await repo.save(repo.create({ organizationId: u.organizationId, projectId: project?.id ?? null, ownerId, title: dto.title.trim(), description: dto.description ?? '', dueDate: dto.dueDate ?? null }));
    return this.emit(u, 'GOAL_CREATED', await this.get(u.organizationId, goal.id));
  }

  async update(u: AuthPrincipal, id: string, dto: UpdateGoalDto) {
    const goal = await this.load(u.organizationId, id);
    if (dto.ownerId) await this.assertMember(u.organizationId, dto.ownerId);
    const { tasks: _t, keyResults: _k, owner: _o, project: _p, ...plain } = goal;
    await this.dataSource.getRepository(Goal).save({ ...plain, ...Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) });
    return this.emit(u, 'GOAL_UPDATED', await this.get(u.organizationId, id));
  }

  async remove(u: AuthPrincipal, id: string) {
    await this.load(u.organizationId, id);
    await this.dataSource.getRepository(Goal).delete({ id });
    return { id, deleted: true };
  }

  async addKeyResult(u: AuthPrincipal, goalId: string, dto: KeyResultDto) {
    await this.load(u.organizationId, goalId);
    const repo = this.dataSource.getRepository(KeyResult);
    await repo.save(repo.create({ goalId, title: dto.title.trim(), kind: dto.kind ?? KeyResultKind.NUMBER, startValue: dto.startValue ?? 0, targetValue: dto.targetValue ?? 100, currentValue: dto.currentValue ?? dto.startValue ?? 0, unit: dto.unit ?? '' }));
    return this.emit(u, 'GOAL_UPDATED', await this.get(u.organizationId, goalId));
  }

  async updateKeyResult(u: AuthPrincipal, goalId: string, krId: string, dto: UpdateKeyResultDto) {
    await this.load(u.organizationId, goalId);
    const repo = this.dataSource.getRepository(KeyResult);
    const kr = await repo.findOneBy({ id: krId, goalId });
    if (!kr) throw ApiException.notFound('key_result');
    Object.assign(kr, Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)));
    await repo.save(kr);
    return this.emit(u, 'GOAL_UPDATED', await this.get(u.organizationId, goalId));
  }

  async removeKeyResult(u: AuthPrincipal, goalId: string, krId: string) {
    await this.load(u.organizationId, goalId);
    await this.dataSource.getRepository(KeyResult).delete({ id: krId, goalId });
    return this.get(u.organizationId, goalId);
  }

  async linkTask(u: AuthPrincipal, goalId: string, taskIdOrKey: string) {
    await this.load(u.organizationId, goalId);
    const task = await findTask(this.dataSource.manager, u.organizationId, taskIdOrKey);
    await this.dataSource.query('INSERT INTO goal_tasks (goal_id, task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [goalId, task.id]);
    return this.emit(u, 'GOAL_UPDATED', await this.get(u.organizationId, goalId));
  }

  async unlinkTask(u: AuthPrincipal, goalId: string, taskId: string) {
    await this.load(u.organizationId, goalId);
    await this.dataSource.query('DELETE FROM goal_tasks WHERE goal_id = $1 AND task_id = $2', [goalId, taskId]);
    return this.get(u.organizationId, goalId);
  }

  private async assertMember(orgId: string, userId: string) {
    if (!(await this.dataSource.getRepository(Membership).existsBy({ organizationId: orgId, userId }))) throw ApiException.badRequest('INVALID_OWNER', 'Owner must be a member of this organization');
  }

  private emit<T extends { project: { id: string } | null }>(u: AuthPrincipal, type: 'GOAL_CREATED' | 'GOAL_UPDATED', goal: T) {
    this.events.publish(type, { organizationId: u.organizationId, projectId: goal.project?.id, actor: actorOf(u), data: { goal } });
    return goal;
  }
}

@ApiTags('goals')
@ApiBearerAuth()
@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  list(@CurrentUser() u: AuthPrincipal, @Query('projectId') projectId?: string) {
    return this.goals.list(u.organizationId, projectId);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.goals.get(u.organizationId, id);
  }

  @MinRole(Role.MEMBER)
  @Post()
  create(@CurrentUser() u: AuthPrincipal, @Body() dto: CreateGoalDto) {
    return this.goals.create(u, dto);
  }

  @MinRole(Role.MEMBER)
  @Patch(':id')
  update(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGoalDto) {
    return this.goals.update(u, id, dto);
  }

  @MinRole(Role.ADMIN)
  @Delete(':id')
  remove(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.goals.remove(u, id);
  }

  @MinRole(Role.MEMBER)
  @Post(':id/key-results')
  addKr(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: KeyResultDto) {
    return this.goals.addKeyResult(u, id, dto);
  }

  @MinRole(Role.MEMBER)
  @Patch(':id/key-results/:krId')
  updateKr(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Param('krId', ParseUUIDPipe) krId: string, @Body() dto: UpdateKeyResultDto) {
    return this.goals.updateKeyResult(u, id, krId, dto);
  }

  @MinRole(Role.MEMBER)
  @Delete(':id/key-results/:krId')
  removeKr(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Param('krId', ParseUUIDPipe) krId: string) {
    return this.goals.removeKeyResult(u, id, krId);
  }

  @MinRole(Role.MEMBER)
  @Post(':id/tasks')
  link(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkTaskDto) {
    return this.goals.linkTask(u, id, dto.taskId);
  }

  @MinRole(Role.MEMBER)
  @Delete(':id/tasks/:taskId')
  unlink(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.goals.unlinkTask(u, id, taskId);
  }
}

@Module({ controllers: [GoalsController], providers: [GoalsService] })
export class GoalsModule {}
