import { Body, Controller, Delete, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsHexColor, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { CurrentUser, MinRole } from '../../common/auth/decorators';
import { actorOf, AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { EventBus } from '../../common/events/event-bus.service';
import { ApiException } from '../../common/http/api-exception';
import { findProject } from '../projects/projects.service';
import { CustomField, FieldOption, FieldType, toFieldDto } from './custom-field.entity';

const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#14b8a6', '#8b5cf6'];

class OptionDto {
  /** Keep an existing option's id when editing, so task values stay attached. */
  @IsOptional() @IsString() @MaxLength(40) id?: string;
  @IsString() @MinLength(1) @MaxLength(60) label: string;
  @IsOptional() @IsHexColor() color?: string;
}

class CreateFieldDto {
  @IsString() @MinLength(1) @MaxLength(60) name: string;
  @IsEnum(FieldType) type: FieldType;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => OptionDto) options?: OptionDto[];
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsBoolean() showInList?: boolean;
}

class UpdateFieldDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => OptionDto) options?: OptionDto[];
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsBoolean() showInList?: boolean;
  @IsOptional() @IsInt() @Min(0) position?: number;
}

const isChoice = (t: FieldType) => t === FieldType.SELECT || t === FieldType.MULTI_SELECT;

@Injectable()
export class FieldsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  async list(orgId: string, projectIdOrKey: string) {
    const project = await findProject(this.dataSource.manager, orgId, projectIdOrKey);
    return this.fieldsOf(project.id);
  }

  private async fieldsOf(projectId: string) {
    const rows = await this.dataSource.getRepository(CustomField).find({ where: { projectId }, order: { position: 'ASC', createdAt: 'ASC' } });
    return rows.map(toFieldDto);
  }

  async create(u: AuthPrincipal, projectIdOrKey: string, dto: CreateFieldDto) {
    const project = await findProject(this.dataSource.manager, u.organizationId, projectIdOrKey);
    const repo = this.dataSource.getRepository(CustomField);
    const existing = await repo.find({ where: { projectId: project.id } });
    if (existing.length >= 50) throw ApiException.badRequest('TOO_MANY_FIELDS', 'A project can have at most 50 custom fields');
    this.assertUniqueName(existing, dto.name);
    if (isChoice(dto.type) && !dto.options?.length) throw ApiException.badRequest('OPTIONS_REQUIRED', 'Select fields need at least one option');
    await repo.save(
      repo.create({
        organizationId: u.organizationId,
        projectId: project.id,
        name: dto.name.trim(),
        type: dto.type,
        options: isChoice(dto.type) ? this.options(dto.options!, []) : [],
        position: existing.length,
        required: dto.required ?? false,
        showInList: dto.showInList ?? true,
      }),
    );
    return this.changed(u, project.id);
  }

  async update(u: AuthPrincipal, id: string, dto: UpdateFieldDto) {
    const repo = this.dataSource.getRepository(CustomField);
    const field = await repo.findOneBy({ id, organizationId: u.organizationId });
    if (!field) throw ApiException.notFound('field');
    const siblings = await repo.find({ where: { projectId: field.projectId }, order: { position: 'ASC', createdAt: 'ASC' } });
    if (dto.name !== undefined) {
      this.assertUniqueName(siblings.filter((f) => f.id !== id), dto.name);
      field.name = dto.name.trim();
    }
    if (dto.required !== undefined) field.required = dto.required;
    if (dto.showInList !== undefined) field.showInList = dto.showInList;
    await this.dataSource.transaction(async (m) => {
      if (dto.options !== undefined) {
        if (!isChoice(field.type)) throw ApiException.badRequest('NOT_A_SELECT', 'Only select fields have options');
        if (!dto.options.length) throw ApiException.badRequest('OPTIONS_REQUIRED', 'Select fields need at least one option');
        field.options = this.options(dto.options, field.options);
        await this.pruneOptions(m, field);
      }
      await m.save(field);
      if (dto.position !== undefined) {
        const order = siblings.filter((f) => f.id !== id);
        order.splice(Math.min(dto.position, order.length), 0, field);
        for (const [i, f] of order.entries()) await m.update(CustomField, { id: f.id }, { position: i });
      }
    });
    return this.changed(u, field.projectId);
  }

  async remove(u: AuthPrincipal, id: string) {
    const field = await this.dataSource.getRepository(CustomField).findOneBy({ id, organizationId: u.organizationId });
    if (!field) throw ApiException.notFound('field');
    await this.dataSource.transaction(async (m) => {
      await m.query(`UPDATE tasks SET custom_values = custom_values - $1::text WHERE project_id = $2 AND custom_values ? $1::text`, [field.id, field.projectId]);
      await m.delete(CustomField, { id: field.id });
    });
    return this.changed(u, field.projectId);
  }

  /** Keeps ids of options that still exist; drops task values pointing at removed options. */
  private async pruneOptions(m: DataSource['manager'], field: CustomField) {
    const keep = new Set(field.options.map((o) => o.id));
    const rows: { id: string; v: unknown }[] = await m.query(`SELECT id, custom_values -> $1::text AS v FROM tasks WHERE project_id = $2 AND custom_values ? $1::text`, [field.id, field.projectId]);
    for (const r of rows) {
      const next = Array.isArray(r.v) ? r.v.filter((x) => keep.has(x)) : keep.has(r.v as string) ? r.v : null;
      if (JSON.stringify(next) === JSON.stringify(r.v)) continue;
      if (next === null || (Array.isArray(next) && !next.length)) await m.query(`UPDATE tasks SET custom_values = custom_values - $1::text WHERE id = $2`, [field.id, r.id]);
      else await m.query(`UPDATE tasks SET custom_values = jsonb_set(custom_values, ARRAY[$1::text], $3::jsonb) WHERE id = $2`, [field.id, r.id, JSON.stringify(next)]);
    }
  }

  private options(input: OptionDto[], existing: FieldOption[]): FieldOption[] {
    const labels = new Set<string>();
    return input.map((o, i) => {
      const label = o.label.trim();
      if (labels.has(label.toLowerCase())) throw ApiException.badRequest('DUPLICATE_OPTION', `Option "${label}" appears twice`);
      labels.add(label.toLowerCase());
      const keep = o.id && existing.some((e) => e.id === o.id);
      return { id: keep ? o.id! : randomUUID().slice(0, 8), label, color: o.color ?? existing.find((e) => e.id === o.id)?.color ?? PALETTE[i % PALETTE.length] };
    });
  }

  private assertUniqueName(fields: CustomField[], name: string) {
    if (fields.some((f) => f.name.toLowerCase() === name.trim().toLowerCase())) throw ApiException.conflict('FIELD_EXISTS', `A field named "${name.trim()}" already exists`);
  }

  private async changed(u: AuthPrincipal, projectId: string) {
    const fields = await this.fieldsOf(projectId);
    this.events.publish('FIELDS_UPDATED', { organizationId: u.organizationId, projectId, actor: actorOf(u), data: { fields } });
    return fields;
  }
}

@ApiTags('custom fields')
@ApiBearerAuth()
@Controller()
export class FieldsController {
  constructor(private readonly fields: FieldsService) {}

  @Get('projects/:projectId/fields')
  list(@CurrentUser() u: AuthPrincipal, @Param('projectId') projectId: string) {
    return this.fields.list(u.organizationId, projectId);
  }

  @MinRole(Role.MEMBER)
  @Post('projects/:projectId/fields')
  create(@CurrentUser() u: AuthPrincipal, @Param('projectId') projectId: string, @Body() dto: CreateFieldDto) {
    return this.fields.create(u, projectId, dto);
  }

  @MinRole(Role.MEMBER)
  @Patch('fields/:id')
  update(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFieldDto) {
    return this.fields.update(u, id, dto);
  }

  @MinRole(Role.MEMBER)
  @Delete('fields/:id')
  remove(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.fields.remove(u, id);
  }
}

@Module({ controllers: [FieldsController], providers: [FieldsService], exports: [FieldsService] })
export class FieldsModule {}
