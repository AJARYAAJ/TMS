import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsHexColor, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { CurrentUser, MinRole } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { ApiException } from '../../common/http/api-exception';
import { Label, toLabelDto } from './label.entity';

class CreateLabelDto {
  @IsString() @MinLength(1) @MaxLength(40) name: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
}

class UpdateLabelDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) name?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
}

class MergeLabelDto {
  /** The label that survives; this label's tasks move to it and this label is deleted. */
  @IsUUID() into: string;
}

/** Organization-wide labels (tags) that can be applied to any task. */
@ApiTags('labels')
@ApiBearerAuth()
@Controller('labels')
export class LabelsController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async list(@CurrentUser() u: AuthPrincipal) {
    const rows: (Label & { usage: number })[] = await this.dataSource.query(
      `SELECT l.id, l.name, l.color, l.description,
              (SELECT COUNT(*) FROM task_labels tl JOIN tasks t ON t.id = tl.task_id WHERE tl.label_id = l.id)::int AS usage,
              (SELECT COUNT(*) FROM task_labels tl JOIN tasks t ON t.id = tl.task_id WHERE tl.label_id = l.id AND t.status <> 'DONE')::int AS "openUsage"
         FROM labels l WHERE l.organization_id = $1 ORDER BY lower(l.name)`,
      [u.organizationId],
    );
    return rows;
  }

  @MinRole(Role.MEMBER)
  @Post()
  async create(@CurrentUser() u: AuthPrincipal, @Body() dto: CreateLabelDto) {
    const repo = this.dataSource.getRepository(Label);
    const exists = await repo.createQueryBuilder('l').where('l.organization_id = :org AND lower(l.name) = lower(:name)', { org: u.organizationId, name: dto.name.trim() }).getOne();
    if (exists) throw ApiException.conflict('LABEL_EXISTS', `A label named "${exists.name}" already exists`);
    return toLabelDto(await repo.save(repo.create({ organizationId: u.organizationId, name: dto.name.trim(), color: dto.color ?? '#6366f1', description: dto.description?.trim() ?? '' })));
  }

  @MinRole(Role.MEMBER)
  @Patch(':id')
  async update(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLabelDto) {
    const repo = this.dataSource.getRepository(Label);
    const label = await repo.findOneBy({ id, organizationId: u.organizationId });
    if (!label) throw ApiException.notFound('label');
    if (dto.name && dto.name.trim().toLowerCase() !== label.name.toLowerCase()) {
      const clash = await repo.createQueryBuilder('l').where('l.organization_id = :org AND lower(l.name) = lower(:name) AND l.id <> :id', { org: u.organizationId, name: dto.name.trim(), id }).getOne();
      if (clash) throw ApiException.conflict('LABEL_EXISTS', `A label named "${clash.name}" already exists — merge them instead`);
    }
    if (dto.name) label.name = dto.name.trim();
    if (dto.color) label.color = dto.color;
    if (dto.description !== undefined) label.description = dto.description.trim();
    return toLabelDto(await repo.save(label));
  }

  /** Merges duplicate labels: every task with this label gets `into` instead; this label is deleted. */
  @MinRole(Role.ADMIN)
  @Post(':id/merge')
  @HttpCode(200)
  async merge(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MergeLabelDto) {
    if (id === dto.into) throw ApiException.badRequest('INVALID_MERGE', 'Pick a different label to merge into');
    return this.dataSource.transaction(async (m) => {
      const [from, into] = await Promise.all([m.findOneBy(Label, { id, organizationId: u.organizationId }), m.findOneBy(Label, { id: dto.into, organizationId: u.organizationId })]);
      if (!from || !into) throw ApiException.notFound('label');
      const [{ moved }] = await m.query(`SELECT COUNT(*)::int AS moved FROM task_labels WHERE label_id = $1`, [from.id]);
      await m.query(`INSERT INTO task_labels (task_id, label_id) SELECT task_id, $2 FROM task_labels WHERE label_id = $1 ON CONFLICT DO NOTHING`, [from.id, into.id]);
      await m.delete(Label, { id: from.id });
      return { merged: from.name, into: toLabelDto(into), moved };
    });
  }

  @MinRole(Role.ADMIN)
  @Delete(':id')
  async remove(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.dataSource.getRepository(Label).delete({ id, organizationId: u.organizationId });
    if (!result.affected) throw ApiException.notFound('label');
    return { id, deleted: true };
  }
}

@Module({ controllers: [LabelsController] })
export class LabelsModule {}
