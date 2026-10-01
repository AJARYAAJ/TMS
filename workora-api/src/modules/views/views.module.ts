import { Body, Controller, Delete, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Column, CreateDateColumn, DataSource, Entity, IsNull, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { CurrentUser } from '../../common/auth/decorators';
import { actorOf, AuthPrincipal } from '../../common/auth/principal';
import { hasRole, Role } from '../../common/auth/roles';
import { EventBus } from '../../common/events/event-bus.service';
import { ApiException } from '../../common/http/api-exception';
import { findProject } from '../projects/projects.service';

/** A named set of List-view filters, sort and columns. Personal, or shared with the workspace. */
@Entity('saved_views')
export class SavedView {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  /** null = a cross-project view (e.g. My Work). */
  @Column({ type: 'uuid', nullable: true }) projectId: string | null;
  @Column('uuid') ownerId: string;
  @Column() name: string;
  @Column({ default: false }) shared: boolean;
  @Column({ type: 'jsonb', default: {} }) config: Record<string, unknown>;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

const toViewDto = (v: SavedView, me: string) => ({
  id: v.id,
  projectId: v.projectId,
  name: v.name,
  shared: v.shared,
  mine: v.ownerId === me,
  config: v.config,
  updatedAt: v.updatedAt,
});

class CreateViewDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  /** Project id or key; omit for a workspace-wide view. */
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsBoolean() shared?: boolean;
  @IsObject() config: Record<string, unknown>;
}

class UpdateViewDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() shared?: boolean;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
}

const assertConfigSize = (config: unknown) => {
  if (JSON.stringify(config).length > 8000) throw ApiException.badRequest('VIEW_TOO_LARGE', 'View configuration is too large');
};

@Injectable()
export class ViewsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  private repo() {
    return this.dataSource.getRepository(SavedView);
  }

  async list(u: AuthPrincipal, projectIdOrKey?: string) {
    const projectId = projectIdOrKey ? (await findProject(this.dataSource.manager, u.organizationId, projectIdOrKey)).id : null;
    const scope = { organizationId: u.organizationId, projectId: projectId ?? IsNull() };
    const rows = await this.repo().find({ where: [{ ...scope, ownerId: u.userId }, { ...scope, shared: true }], order: { name: 'ASC' } });
    return rows.map((v) => toViewDto(v, u.userId));
  }

  async create(u: AuthPrincipal, dto: CreateViewDto) {
    assertConfigSize(dto.config);
    const projectId = dto.projectId ? (await findProject(this.dataSource.manager, u.organizationId, dto.projectId)).id : null;
    if (dto.shared && u.role === Role.VIEWER) throw ApiException.forbidden('Viewers cannot share views');
    const view = await this.repo().save(this.repo().create({ organizationId: u.organizationId, projectId, ownerId: u.userId, name: dto.name.trim(), shared: !!dto.shared, config: dto.config }));
    this.changed(u, view);
    return toViewDto(view, u.userId);
  }

  async update(u: AuthPrincipal, id: string, dto: UpdateViewDto) {
    const view = await this.editable(u, id);
    if (dto.config) {
      assertConfigSize(dto.config);
      view.config = dto.config;
    }
    if (dto.name !== undefined) view.name = dto.name.trim();
    if (dto.shared !== undefined) view.shared = dto.shared;
    await this.repo().save(view);
    this.changed(u, view);
    return toViewDto(view, u.userId);
  }

  async remove(u: AuthPrincipal, id: string) {
    const view = await this.editable(u, id);
    await this.repo().delete({ id: view.id });
    this.changed(u, view);
    return { id, deleted: true };
  }

  /** Owners edit their views; admins can also manage shared ones. */
  private async editable(u: AuthPrincipal, id: string) {
    const view = await this.repo().findOneBy({ id, organizationId: u.organizationId });
    if (!view || (view.ownerId !== u.userId && !view.shared)) throw ApiException.notFound('view');
    if (view.ownerId !== u.userId && !hasRole(u.role, Role.ADMIN)) throw ApiException.forbidden('Only the owner or an admin can change this view');
    return view;
  }

  private changed(u: AuthPrincipal, view: SavedView) {
    if (view.shared || view.projectId) this.events.publish('VIEWS_UPDATED', { organizationId: u.organizationId, projectId: view.projectId ?? undefined, actor: actorOf(u), data: { viewId: view.id } });
  }
}

@ApiTags('saved views')
@ApiBearerAuth()
@Controller('views')
export class ViewsController {
  constructor(private readonly views: ViewsService) {}

  @Get()
  list(@CurrentUser() u: AuthPrincipal, @Query('projectId') projectId?: string) {
    return this.views.list(u, projectId);
  }

  @Post()
  create(@CurrentUser() u: AuthPrincipal, @Body() dto: CreateViewDto) {
    return this.views.create(u, dto);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateViewDto) {
    return this.views.update(u, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.views.remove(u, id);
  }
}

@Module({ controllers: [ViewsController], providers: [ViewsService] })
export class ViewsModule {}
