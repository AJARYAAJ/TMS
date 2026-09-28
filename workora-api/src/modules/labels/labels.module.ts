import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsHexColor, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { CurrentUser, MinRole } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { ApiException } from '../../common/http/api-exception';
import { Label, toLabelDto } from './label.entity';

class CreateLabelDto {
  @IsString() @MinLength(1) @MaxLength(40) name: string;
  @IsOptional() @IsHexColor() color?: string;
}

class UpdateLabelDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) name?: string;
  @IsOptional() @IsHexColor() color?: string;
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
      `SELECT l.id, l.name, l.color, (SELECT COUNT(*) FROM task_labels tl WHERE tl.label_id = l.id)::int AS usage
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
    return toLabelDto(await repo.save(repo.create({ organizationId: u.organizationId, name: dto.name.trim(), color: dto.color ?? '#6366f1' })));
  }

  @MinRole(Role.MEMBER)
  @Patch(':id')
  async update(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLabelDto) {
    const repo = this.dataSource.getRepository(Label);
    const label = await repo.findOneBy({ id, organizationId: u.organizationId });
    if (!label) throw ApiException.notFound('label');
    if (dto.name) label.name = dto.name.trim();
    if (dto.color) label.color = dto.color;
    return toLabelDto(await repo.save(label));
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
