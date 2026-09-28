import { Body, Controller, Delete, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { CurrentUser, MinRole } from '../../common/auth/decorators';
import { actorOf, AuthPrincipal } from '../../common/auth/principal';
import { hasRole, Role } from '../../common/auth/roles';
import { EventBus } from '../../common/events/event-bus.service';
import { ApiException } from '../../common/http/api-exception';
import { Membership } from '../organizations/membership.entity';
import { findTask } from '../tasks/tasks.service';
import { toTaskDto } from '../tasks/tasks.dto';
import { toUserSummary } from '../users/user.entity';
import { Comment } from './comment.entity';

class CommentBodyDto {
  @IsString() @MinLength(1) @MaxLength(20000) body: string;
}

export const toCommentDto = (c: Comment) => ({
  id: c.id,
  taskId: c.taskId,
  body: c.body,
  author: toUserSummary(c.author),
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

@Injectable()
export class CommentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  async list(orgId: string, taskIdOrKey: string) {
    const task = await findTask(this.dataSource.manager, orgId, taskIdOrKey);
    const rows = await this.dataSource.getRepository(Comment).find({ where: { taskId: task.id }, relations: { author: true }, order: { createdAt: 'ASC' } });
    return rows.map(toCommentDto);
  }

  async create(principal: AuthPrincipal, taskIdOrKey: string, body: string) {
    const task = await findTask(this.dataSource.manager, principal.organizationId, taskIdOrKey);
    const repo = this.dataSource.getRepository(Comment);
    const saved = await repo.save(repo.create({ organizationId: principal.organizationId, taskId: task.id, authorId: principal.userId, body: body.trim() }));
    const comment = await repo.findOneOrFail({ where: { id: saved.id }, relations: { author: true } });
    const dto = toCommentDto(comment);
    const mentionedUserIds = await this.resolveMentions(principal.organizationId, comment.body);
    this.events.publish('COMMENT_CREATED', {
      organizationId: principal.organizationId,
      projectId: task.projectId,
      actor: actorOf(principal),
      data: { comment: dto, task: toTaskDto(task), mentionedUserIds },
    });
    return dto;
  }

  async update(principal: AuthPrincipal, id: string, body: string) {
    const comment = await this.findOwned(principal, id);
    comment.body = body.trim();
    await this.dataSource.getRepository(Comment).save(comment);
    return toCommentDto(comment);
  }

  async remove(principal: AuthPrincipal, id: string) {
    const comment = await this.findOwned(principal, id);
    await this.dataSource.getRepository(Comment).delete({ id: comment.id });
    return { id, deleted: true };
  }

  private async findOwned(principal: AuthPrincipal, id: string) {
    const comment = await this.dataSource.getRepository(Comment).findOne({ where: { id, organizationId: principal.organizationId }, relations: { author: true } });
    if (!comment) throw ApiException.notFound('comment');
    if (comment.authorId !== principal.userId && !hasRole(principal.role, Role.ADMIN)) throw ApiException.forbidden('You can only change your own comments');
    return comment;
  }

  /** `@rahul` or `@rahul@acme.com` mentions resolve to organization members by first name or email. */
  private async resolveMentions(orgId: string, body: string) {
    const tokens = new Set([...body.matchAll(/(?:^|\s)@([\w.+-]+(?:@[\w.-]+)?)/g)].map((m) => m[1].toLowerCase().replace(/[.]+$/, '')));
    if (!tokens.size) return [];
    const members = await this.dataSource.getRepository(Membership).find({ where: { organizationId: orgId }, relations: { user: true } });
    return members
      .filter(({ user }) => tokens.has(user.email.toLowerCase()) || tokens.has(user.name.split(/\s+/)[0].toLowerCase()) || tokens.has(user.email.split('@')[0].toLowerCase()))
      .map((m) => m.userId);
  }
}

@ApiTags('comments')
@ApiBearerAuth()
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('tasks/:taskId/comments')
  list(@CurrentUser() u: AuthPrincipal, @Param('taskId') taskId: string) {
    return this.comments.list(u.organizationId, taskId);
  }

  @MinRole(Role.MEMBER)
  @Post('tasks/:taskId/comments')
  create(@CurrentUser() u: AuthPrincipal, @Param('taskId') taskId: string, @Body() dto: CommentBodyDto) {
    return this.comments.create(u, taskId, dto.body);
  }

  @MinRole(Role.MEMBER)
  @Patch('comments/:id')
  update(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommentBodyDto) {
    return this.comments.update(u, id, dto.body);
  }

  @MinRole(Role.MEMBER)
  @Delete('comments/:id')
  remove(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.comments.remove(u, id);
  }
}

@Module({ controllers: [CommentsController], providers: [CommentsService] })
export class CommentsModule {}
