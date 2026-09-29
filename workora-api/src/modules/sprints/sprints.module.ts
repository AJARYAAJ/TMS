import { Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { DataSource, Not } from 'typeorm';
import { CurrentUser, MinRole } from '../../common/auth/decorators';
import { actorOf, AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { EventBus } from '../../common/events/event-bus.service';
import { ApiException } from '../../common/http/api-exception';
import { findProject } from '../projects/projects.service';
import { Task, TaskStatus } from '../tasks/task.entity';
import { Sprint, SprintStatus } from './sprint.entity';

class CreateSprintDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(2000) goal?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
}

class UpdateSprintDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) goal?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
}

export function toSprintDto(s: Sprint, stats?: { total: number; done: number; points: number; donePoints: number }) {
  return {
    id: s.id,
    projectId: s.projectId,
    name: s.name,
    goal: s.goal,
    status: s.status,
    startDate: s.startDate,
    endDate: s.endDate,
    completedAt: s.completedAt,
    createdAt: s.createdAt,
    stats: stats ?? { total: 0, done: 0, points: 0, donePoints: 0 },
  };
}

@Injectable()
export class SprintsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  async list(orgId: string, projectIdOrKey: string) {
    const project = await findProject(this.dataSource.manager, orgId, projectIdOrKey);
    const sprints = await this.dataSource.getRepository(Sprint).find({ where: { projectId: project.id }, order: { createdAt: 'ASC' } });
    const rows = await this.dataSource
      .getRepository(Task)
      .createQueryBuilder('t')
      .select('t.sprint_id', 'sprintId')
      .addSelect('COUNT(*)::int', 'total')
      .addSelect(`COUNT(*) FILTER (WHERE t.status = 'DONE')::int`, 'done')
      .addSelect('COALESCE(SUM(t.story_points), 0)::int', 'points')
      .addSelect(`COALESCE(SUM(t.story_points) FILTER (WHERE t.status = 'DONE'), 0)::int`, 'donePoints')
      .where('t.project_id = :pid AND t.sprint_id IS NOT NULL', { pid: project.id })
      .groupBy('t.sprint_id')
      .getRawMany();
    const stats = new Map(rows.map((r) => [r.sprintId, r]));
    return sprints.map((s) => toSprintDto(s, stats.get(s.id)));
  }

  async create(principal: AuthPrincipal, projectIdOrKey: string, dto: CreateSprintDto) {
    const project = await findProject(this.dataSource.manager, principal.organizationId, projectIdOrKey);
    const repo = this.dataSource.getRepository(Sprint);
    const sprint = await repo.save(
      repo.create({ organizationId: principal.organizationId, projectId: project.id, name: dto.name.trim(), goal: dto.goal ?? '', startDate: dto.startDate ?? null, endDate: dto.endDate ?? null }),
    );
    const dto$ = toSprintDto(sprint);
    this.events.publish('SPRINT_CREATED', { organizationId: principal.organizationId, projectId: project.id, actor: actorOf(principal), data: { sprint: dto$ } });
    return dto$;
  }

  async update(principal: AuthPrincipal, id: string, dto: UpdateSprintDto) {
    const sprint = await this.find(principal.organizationId, id);
    Object.assign(sprint, Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)));
    await this.dataSource.getRepository(Sprint).save(sprint);
    const dto$ = toSprintDto(sprint);
    this.events.publish('SPRINT_UPDATED', { organizationId: principal.organizationId, projectId: sprint.projectId, actor: actorOf(principal), data: { sprint: dto$ } });
    return dto$;
  }

  async start(principal: AuthPrincipal, id: string) {
    const sprint = await this.dataSource.transaction(async (m) => {
      const sprint = await this.find(principal.organizationId, id, m.getRepository(Sprint));
      if (sprint.status !== SprintStatus.PLANNED) throw ApiException.badRequest('SPRINT_NOT_PLANNED', 'Only planned sprints can be started');
      if (await m.existsBy(Sprint, { projectId: sprint.projectId, status: SprintStatus.ACTIVE, id: Not(sprint.id) })) {
        throw ApiException.conflict('SPRINT_ALREADY_ACTIVE', 'This project already has an active sprint');
      }
      sprint.status = SprintStatus.ACTIVE;
      sprint.startDate ??= new Date().toISOString().slice(0, 10);
      if (!sprint.endDate) {
        const end = new Date();
        end.setDate(end.getDate() + 14);
        sprint.endDate = end.toISOString().slice(0, 10);
      }
      return m.save(sprint);
    });
    const dto$ = toSprintDto(sprint);
    this.events.publish('SPRINT_STARTED', { organizationId: principal.organizationId, projectId: sprint.projectId, actor: actorOf(principal), data: { sprint: dto$ } });
    return dto$;
  }

  /** Completes the sprint; unfinished tasks return to the backlog. */
  async complete(principal: AuthPrincipal, id: string) {
    const { sprint, movedToBacklog } = await this.dataSource.transaction(async (m) => {
      const sprint = await this.find(principal.organizationId, id, m.getRepository(Sprint));
      if (sprint.status !== SprintStatus.ACTIVE) throw ApiException.badRequest('SPRINT_NOT_ACTIVE', 'Only active sprints can be completed');
      const [stats] = await m.query(
        `SELECT COALESCE(SUM(story_points), 0)::int AS "committedPoints",
                COALESCE(SUM(story_points) FILTER (WHERE status = 'DONE'), 0)::int AS "completedPoints",
                COUNT(*)::int AS "committedCount",
                COUNT(*) FILTER (WHERE status = 'DONE')::int AS "completedCount"
           FROM tasks WHERE sprint_id = $1`,
        [sprint.id],
      );
      sprint.completionStats = stats;
      const result = await m.update(Task, { sprintId: sprint.id, status: Not(TaskStatus.DONE) }, { sprintId: null });
      sprint.status = SprintStatus.COMPLETED;
      sprint.completedAt = new Date();
      return { sprint: await m.save(sprint), movedToBacklog: result.affected ?? 0 };
    });
    const dto$ = toSprintDto(sprint);
    this.events.publish('SPRINT_COMPLETED', { organizationId: principal.organizationId, projectId: sprint.projectId, actor: actorOf(principal), data: { sprint: dto$, movedToBacklog } });
    return { ...dto$, movedToBacklog };
  }

  private async find(orgId: string, id: string, repo = this.dataSource.getRepository(Sprint)) {
    const sprint = await repo.findOneBy({ id, organizationId: orgId });
    if (!sprint) throw ApiException.notFound('sprint');
    return sprint;
  }
}

@ApiTags('sprints')
@ApiBearerAuth()
@Controller()
export class SprintsController {
  constructor(private readonly sprints: SprintsService) {}

  @Get('projects/:projectId/sprints')
  list(@CurrentUser() u: AuthPrincipal, @Param('projectId') projectId: string) {
    return this.sprints.list(u.organizationId, projectId);
  }

  @MinRole(Role.MEMBER)
  @Post('projects/:projectId/sprints')
  create(@CurrentUser() u: AuthPrincipal, @Param('projectId') projectId: string, @Body() dto: CreateSprintDto) {
    return this.sprints.create(u, projectId, dto);
  }

  @MinRole(Role.MEMBER)
  @Patch('sprints/:id')
  update(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSprintDto) {
    return this.sprints.update(u, id, dto);
  }

  @MinRole(Role.MEMBER)
  @Post('sprints/:id/start')
  start(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.sprints.start(u, id);
  }

  @MinRole(Role.MEMBER)
  @Post('sprints/:id/complete')
  complete(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.sprints.complete(u, id);
  }
}

@Module({ controllers: [SprintsController], providers: [SprintsService], exports: [SprintsService] })
export class SprintsModule {}
