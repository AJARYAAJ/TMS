import { Body, Controller, Delete, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { DataSource, IsNull } from 'typeorm';
import { CurrentUser, MinRole } from '../../common/auth/decorators';
import { actorOf, AuthPrincipal } from '../../common/auth/principal';
import { hasRole, Role } from '../../common/auth/roles';
import { EventBus } from '../../common/events/event-bus.service';
import { ApiException } from '../../common/http/api-exception';
import { findProject } from '../projects/projects.service';
import { toUserSummary } from '../users/user.entity';
import { Document } from './document.entity';

class CreateDocumentDto {
  @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(8) icon?: string;
  @IsOptional() @IsString() @MaxLength(500_000) content?: string;
  /** Project UUID/key; omit for a workspace-wide document. */
  @IsOptional() @IsString() projectId?: string;
}

class UpdateDocumentDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(8) icon?: string;
  @IsOptional() @IsString() @MaxLength(500_000) content?: string;
  /** The version the client edited; a mismatch means someone else saved first (409). */
  @IsInt() @Min(1) version: number;
}

const toDocSummary = (d: Document) => ({
  id: d.id,
  title: d.title,
  icon: d.icon,
  projectId: d.projectId,
  author: toUserSummary(d.author),
  updatedBy: toUserSummary(d.updatedBy ?? d.author),
  version: d.version,
  excerpt: d.content.replace(/[#*_`>\-\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160),
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});
const toDocDto = (d: Document) => ({ ...toDocSummary(d), content: d.content });

/** Docs & wiki pages (markdown), per project or workspace-wide, with optimistic concurrency. */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  async list(orgId: string, projectId?: string) {
    const project = projectId && projectId !== 'none' ? await findProject(this.dataSource.manager, orgId, projectId) : null;
    const rows = await this.dataSource.getRepository(Document).find({
      where: { organizationId: orgId, ...(project ? { projectId: project.id } : projectId === 'none' ? { projectId: IsNull() } : {}) },
      relations: { author: true, updatedBy: true },
      order: { updatedAt: 'DESC' },
    });
    return rows.map(toDocSummary);
  }

  async get(orgId: string, id: string) {
    return toDocDto(await this.find(orgId, id));
  }

  async create(u: AuthPrincipal, dto: CreateDocumentDto) {
    const project = dto.projectId ? await findProject(this.dataSource.manager, u.organizationId, dto.projectId) : null;
    const repo = this.dataSource.getRepository(Document);
    const saved = await repo.save(repo.create({ organizationId: u.organizationId, projectId: project?.id ?? null, title: dto.title.trim(), icon: dto.icon || '📄', content: dto.content ?? '', authorId: u.userId, updatedById: u.userId }));
    const doc = toDocSummary(await this.find(u.organizationId, saved.id));
    this.events.publish('DOCUMENT_CREATED', { organizationId: u.organizationId, projectId: doc.projectId ?? undefined, actor: actorOf(u), data: { document: doc } });
    return this.get(u.organizationId, saved.id);
  }

  async update(u: AuthPrincipal, id: string, dto: UpdateDocumentDto) {
    const { version, ...fields } = dto;
    const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    // Compare-and-swap on version: only succeeds if nobody saved since the client loaded it.
    const result = await this.dataSource
      .createQueryBuilder()
      .update(Document)
      .set({ ...patch, updatedById: u.userId, version: () => 'version + 1' })
      .where('id = :id AND organization_id = :org AND version = :version', { id, org: u.organizationId, version })
      .execute();
    if (!result.affected) {
      const current = await this.find(u.organizationId, id);
      throw new ApiException(409, 'DOCUMENT_CONFLICT', `${current.updatedBy?.name ?? 'Someone'} saved a newer version of this document`, { currentVersion: current.version });
    }
    const doc = await this.find(u.organizationId, id);
    this.events.publish('DOCUMENT_UPDATED', { organizationId: u.organizationId, projectId: doc.projectId ?? undefined, actor: actorOf(u), data: { document: toDocSummary(doc) } });
    return toDocDto(doc);
  }

  async remove(u: AuthPrincipal, id: string) {
    const doc = await this.find(u.organizationId, id);
    if (doc.authorId !== u.userId && !hasRole(u.role, Role.ADMIN)) throw ApiException.forbidden('Only the author or an admin can delete this document');
    await this.dataSource.getRepository(Document).delete({ id });
    this.events.publish('DOCUMENT_DELETED', { organizationId: u.organizationId, projectId: doc.projectId ?? undefined, actor: actorOf(u), data: { document: toDocSummary(doc) } });
    return { id, deleted: true };
  }

  private async find(orgId: string, id: string) {
    const doc = await this.dataSource.getRepository(Document).findOne({ where: { id, organizationId: orgId }, relations: { author: true, updatedBy: true } });
    if (!doc) throw ApiException.notFound('document');
    return doc;
  }
}

@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  /** `projectId` = project UUID/key, `none` for workspace docs, omitted for all. */
  @Get()
  list(@CurrentUser() u: AuthPrincipal, @Query('projectId') projectId?: string) {
    return this.docs.list(u.organizationId, projectId);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.docs.get(u.organizationId, id);
  }

  @MinRole(Role.MEMBER)
  @Post()
  create(@CurrentUser() u: AuthPrincipal, @Body() dto: CreateDocumentDto) {
    return this.docs.create(u, dto);
  }

  @MinRole(Role.MEMBER)
  @Patch(':id')
  update(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDocumentDto) {
    return this.docs.update(u, id, dto);
  }

  @MinRole(Role.MEMBER)
  @Delete(':id')
  remove(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.docs.remove(u, id);
  }
}

@Module({ controllers: [DocumentsController], providers: [DocumentsService] })
export class DocumentsModule {}
