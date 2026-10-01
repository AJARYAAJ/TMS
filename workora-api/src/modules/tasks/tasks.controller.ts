import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, MinRole } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { AddLinkDto, BulkUpdateDto, CreateTaskDto, ListTasksQuery, MoveTaskDto, UpdateTaskDto, WatchDto } from './tasks.dto';
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

  /** Multi-select edit: apply one patch to up to 100 tasks. */
  @MinRole(Role.MEMBER)
  @Patch('bulk')
  bulk(@CurrentUser() u: AuthPrincipal, @Body() dto: BulkUpdateDto) {
    return this.tasks.bulkUpdate(u, dto.ids, dto.patch);
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

  @Get(':id/subtasks')
  subtasks(@CurrentUser() u: AuthPrincipal, @Param('id') id: string) {
    return this.tasks.subtasks(u.organizationId, id);
  }

  @Get(':id/watchers')
  async watchers(@CurrentUser() u: AuthPrincipal, @Param('id') id: string) {
    return (await this.tasks.get(u.organizationId, id)).watchers;
  }

  /** Watch a task yourself, or (with `userId`) add someone else as a watcher. */
  @Post(':id/watchers')
  watch(@CurrentUser() u: AuthPrincipal, @Param('id') id: string, @Body() dto: WatchDto) {
    return this.tasks.watch(u, id, dto.userId);
  }

  @Delete(':id/watchers/:userId')
  unwatch(@CurrentUser() u: AuthPrincipal, @Param('id') id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.tasks.unwatch(u, id, userId);
  }

  @Get(':id/links')
  async links(@CurrentUser() u: AuthPrincipal, @Param('id') id: string) {
    return (await this.tasks.get(u.organizationId, id)).links;
  }

  @MinRole(Role.MEMBER)
  @Post(':id/links')
  addLink(@CurrentUser() u: AuthPrincipal, @Param('id') id: string, @Body() dto: AddLinkDto) {
    return this.tasks.addLink(u, id, dto);
  }

  @MinRole(Role.MEMBER)
  @Delete(':id/links/:linkId')
  removeLink(@CurrentUser() u: AuthPrincipal, @Param('id') id: string, @Param('linkId', ParseUUIDPipe) linkId: string) {
    return this.tasks.removeLink(u, id, linkId);
  }
}

/** Trash: soft-deleted tasks are kept for 30 days, then purged by a background job. */
@ApiTags('trash')
@ApiBearerAuth()
@Controller('trash')
export class TrashController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@CurrentUser() u: AuthPrincipal, @Query('projectId') projectId?: string) {
    return this.tasks.trash(u.organizationId, projectId);
  }

  @MinRole(Role.MEMBER)
  @Post(':id/restore')
  @HttpCode(200)
  restore(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.restore(u, id);
  }

  @MinRole(Role.ADMIN)
  @Delete(':id')
  purge(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.purge(u, id);
  }
}
