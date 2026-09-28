import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, MinRole } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { CreateTaskDto, ListTasksQuery, MoveTaskDto, UpdateTaskDto } from './tasks.dto';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@CurrentUser() u: AuthPrincipal, @Query() q: ListTasksQuery) {
    return this.tasks.list(u, q);
  }

  @MinRole(Role.MEMBER)
  @Post()
  create(@CurrentUser() u: AuthPrincipal, @Body() dto: CreateTaskDto) {
    return this.tasks.create(u, dto);
  }

  /** `:id` accepts a UUID or a task key such as ECOM-102. */
  @Get(':id')
  get(@CurrentUser() u: AuthPrincipal, @Param('id') id: string) {
    return this.tasks.get(u.organizationId, id);
  }

  @MinRole(Role.MEMBER)
  @Patch(':id')
  update(@CurrentUser() u: AuthPrincipal, @Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(u, id, dto);
  }

  @MinRole(Role.MEMBER)
  @Patch(':id/status')
  move(@CurrentUser() u: AuthPrincipal, @Param('id') id: string, @Body() dto: MoveTaskDto) {
    return this.tasks.move(u, id, dto);
  }

  @MinRole(Role.MEMBER)
  @Delete(':id')
  remove(@CurrentUser() u: AuthPrincipal, @Param('id') id: string) {
    return this.tasks.remove(u, id);
  }
}
