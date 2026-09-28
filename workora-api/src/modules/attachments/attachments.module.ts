import { Body, Controller, Delete, Get, Inject, Injectable, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { CurrentUser, MinRole } from '../../common/auth/decorators';
import { actorOf, AuthPrincipal } from '../../common/auth/principal';
import { hasRole, Role } from '../../common/auth/roles';
import { APP_CONFIG, AppConfig } from '../../config';
import { EventBus } from '../../common/events/event-bus.service';
import { ApiException } from '../../common/http/api-exception';
import { StorageService } from '../storage/storage.service';
import { findTask } from '../tasks/tasks.service';
import { toUserSummary } from '../users/user.entity';
import { Attachment } from './attachment.entity';

class RequestUploadDto {
  @IsString() @MinLength(1) @MaxLength(255) fileName: string;
  @IsOptional() @IsString() @MaxLength(255) contentType?: string;
  @IsInt() @Min(0) @Max(1024 * 1024 * 1024) size: number;
}

class CompleteUploadDto {
  @Matches(/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/) storageKey: string;
  @IsString() @MinLength(1) @MaxLength(255) fileName: string;
  @IsOptional() @IsString() @MaxLength(255) contentType?: string;
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly events: EventBus,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  toDto(a: Attachment) {
    return {
      id: a.id,
      taskId: a.taskId,
      fileName: a.fileName,
      contentType: a.contentType,
      size: a.size,
      uploader: toUserSummary(a.uploader),
      createdAt: a.createdAt,
      downloadUrl: this.storage.signedUrl('get', a.storageKey, { name: a.fileName, type: a.contentType }).url,
    };
  }

  async list(orgId: string, taskIdOrKey: string) {
    const task = await findTask(this.dataSource.manager, orgId, taskIdOrKey);
    const rows = await this.dataSource.getRepository(Attachment).find({ where: { taskId: task.id }, relations: { uploader: true }, order: { createdAt: 'ASC' } });
    return rows.map((a) => this.toDto(a));
  }

  /** Step 1: hand the client a short-lived signed URL to upload the bytes to. */
  async requestUpload(principal: AuthPrincipal, taskIdOrKey: string, dto: RequestUploadDto) {
    const maxBytes = this.config.maxUploadBytes;
    await findTask(this.dataSource.manager, principal.organizationId, taskIdOrKey);
    if (dto.size > maxBytes) throw new ApiException(413, 'PAYLOAD_TOO_LARGE', `Files may be at most ${maxBytes} bytes`);
    const storageKey = this.storage.newKey(principal.organizationId);
    const { url, expiresAt } = this.storage.signedUrl('put', storageKey);
    return { storageKey, uploadUrl: url, method: 'PUT', headers: { 'Content-Type': dto.contentType || 'application/octet-stream' }, expiresAt };
  }

  /** Step 2: after the upload succeeds, record the attachment and broadcast it. */
  async complete(principal: AuthPrincipal, taskIdOrKey: string, dto: CompleteUploadDto) {
    const task = await findTask(this.dataSource.manager, principal.organizationId, taskIdOrKey);
    if (!dto.storageKey.startsWith(`${principal.organizationId}/`)) throw ApiException.forbidden('Storage key belongs to another organization');
    const stat = await this.storage.stat(dto.storageKey);
    if (!stat) throw ApiException.badRequest('UPLOAD_NOT_FOUND', 'No uploaded object exists for this storage key');
    const repo = this.dataSource.getRepository(Attachment);
    const saved = await repo.save(
      repo.create({
        organizationId: principal.organizationId,
        taskId: task.id,
        uploaderId: principal.userId,
        fileName: dto.fileName,
        contentType: dto.contentType || 'application/octet-stream',
        size: stat.size,
        storageKey: dto.storageKey,
      }),
    );
    const dto$ = this.toDto(await repo.findOneOrFail({ where: { id: saved.id }, relations: { uploader: true } }));
    this.events.publish('ATTACHMENT_ADDED', {
      organizationId: principal.organizationId,
      projectId: task.projectId,
      actor: actorOf(principal),
      data: { attachment: dto$, task: { id: task.id, key: task.key, title: task.title } },
    });
    return dto$;
  }

  async remove(principal: AuthPrincipal, id: string) {
    const repo = this.dataSource.getRepository(Attachment);
    const a = await repo.findOneBy({ id, organizationId: principal.organizationId });
    if (!a) throw ApiException.notFound('attachment');
    if (a.uploaderId !== principal.userId && !hasRole(principal.role, Role.ADMIN)) throw ApiException.forbidden('You can only delete your own attachments');
    const task = await findTask(this.dataSource.manager, principal.organizationId, a.taskId);
    await repo.delete({ id });
    await this.storage.remove(a.storageKey);
    this.events.publish('ATTACHMENT_DELETED', {
      organizationId: principal.organizationId,
      projectId: task.projectId,
      actor: actorOf(principal),
      data: { attachmentId: id, task: { id: task.id, key: task.key, title: task.title } },
    });
    return { id, deleted: true };
  }
}

@ApiTags('attachments')
@ApiBearerAuth()
@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get('tasks/:taskId/attachments')
  list(@CurrentUser() u: AuthPrincipal, @Param('taskId') taskId: string) {
    return this.attachments.list(u.organizationId, taskId);
  }

  @MinRole(Role.MEMBER)
  @Post('tasks/:taskId/attachments/upload-url')
  requestUpload(@CurrentUser() u: AuthPrincipal, @Param('taskId') taskId: string, @Body() dto: RequestUploadDto) {
    return this.attachments.requestUpload(u, taskId, dto);
  }

  @MinRole(Role.MEMBER)
  @Post('tasks/:taskId/attachments')
  complete(@CurrentUser() u: AuthPrincipal, @Param('taskId') taskId: string, @Body() dto: CompleteUploadDto) {
    return this.attachments.complete(u, taskId, dto);
  }

  @MinRole(Role.MEMBER)
  @Delete('attachments/:id')
  remove(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.attachments.remove(u, id);
  }
}

@Module({ controllers: [AttachmentsController], providers: [AttachmentsService] })
export class AttachmentsModule {}
