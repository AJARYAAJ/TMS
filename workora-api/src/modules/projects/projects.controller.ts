import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, MinRole } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { TasksService } from '../tasks/tasks.service';
import { ProjectStatus } from './project.entity';
import { CreateProjectDto, UpdateProjectDto } from './projects.dto';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly tasks: TasksService,
  ) {}

  @Get()
  list(@CurrentUser() u: AuthPrincipal, @Query('status') status?: ProjectStatus) {
    return this.projects.list(u.organizationId, status, u.userId);
  }

  @MinRole(Role.MEMBER)
  @Post()
  create(@CurrentUser() u: AuthPrincipal, @Body() dto: CreateProjectDto) {
    return this.projects.create(u, dto);
  }

  /** Accepts either the project UUID or its key (e.g. ECOM). */
  @Get(':id')
  get(@CurrentUser() u: AuthPrincipal, @Param('id') id: string) {
    return this.projects.get(u.organizationId, id, u.userId);
  }

  @MinRole(Role.ADMIN)
  @Patch(':id')
  update(@CurrentUser() u: AuthPrincipal, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(u, id, dto);
  }

  /** Kanban board: tasks grouped by status column, ordered by position. */
  @Get(':id/board')
  board(@CurrentUser() u: AuthPrincipal, @Param('id') id: string, @Query('sprintId') sprintId?: string) {
    return this.tasks.board(u.organizationId, id, sprintId);
  }
}
