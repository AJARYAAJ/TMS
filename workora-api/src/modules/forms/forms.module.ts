import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { randomBytes } from 'crypto';
import { Column, CreateDateColumn, DataSource, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { CurrentUser, MinRole, Public } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { ApiException } from '../../common/http/api-exception';
import { CustomField, toFieldDto } from '../fields/custom-field.entity';
import { Membership } from '../organizations/membership.entity';
import { Organization } from '../organizations/organization.entity';
import { findProject } from '../projects/projects.service';
import { Project } from '../projects/project.entity';
import { TaskPriority, TaskType } from '../tasks/task.entity';
import { TasksModule } from '../tasks/tasks.module';
import { TasksService } from '../tasks/tasks.service';

export type QuestionKind = 'title' | 'description' | 'email' | 'name' | 'priority' | 'type' | 'dueDate' | 'field';
const KINDS: QuestionKind[] = ['title', 'description', 'email', 'name', 'priority', 'type', 'dueDate', 'field'];

export interface FormQuestion {
  id: string;
  kind: QuestionKind;
  /** Custom field id when kind = field. */
  fieldId?: string;
  label: string;
  help?: string;
  required: boolean;
}

export interface FormDefaults {
  type?: TaskType;
  priority?: TaskPriority;
  stateId?: string;
  assigneeId?: string;
  labelIds?: string[];
}

/** A public intake form: submissions become tasks in the project. */
@Entity('forms')
export class Form {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column('uuid') projectId: string;
  /** Unguessable public identifier used in the share link. */
  @Column({ unique: true }) slug: string;
  @Column() name: string;
  @Column({ type: 'text', default: '' }) description: string;
  @Column({ type: 'jsonb', default: [] }) questions: FormQuestion[];
  @Column({ type: 'jsonb', default: {} }) defaults: FormDefaults;
  @Column({ default: true }) enabled: boolean;
  @Column({ type: 'int', default: 0 }) submissionCount: number;
  @Column({ type: 'timestamptz', nullable: true }) lastSubmittedAt: Date | null;
  @Column('uuid') createdById: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

const toFormDto = (f: Form) => ({
  id: f.id,
  projectId: f.projectId,
  slug: f.slug,
  publicPath: `/f/${f.slug}`,
  name: f.name,
  description: f.description,
  questions: f.questions,
  defaults: f.defaults,
  enabled: f.enabled,
  submissionCount: f.submissionCount,
  lastSubmittedAt: f.lastSubmittedAt,
  createdAt: f.createdAt,
});

class QuestionDto {
  @IsOptional() @IsString() @MaxLength(40) id?: string;
  @IsIn(KINDS) kind: QuestionKind;
  @IsOptional() @IsUUID() fieldId?: string;
  @IsString() @MinLength(1) @MaxLength(200) label: string;
  @IsOptional() @IsString() @MaxLength(500) help?: string;
  @IsOptional() @IsBoolean() required?: boolean;
}

class DefaultsDto {
  @IsOptional() @IsEnum(TaskType) type?: TaskType;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @IsUUID() stateId?: string;
  @IsOptional() @IsUUID() assigneeId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) labelIds?: string[];
}

class CreateFormDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => QuestionDto) questions?: QuestionDto[];
  @IsOptional() @ValidateNested() @Type(() => DefaultsDto) defaults?: DefaultsDto;
}

class UpdateFormDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => QuestionDto) questions?: QuestionDto[];
  @IsOptional() @ValidateNested() @Type(() => DefaultsDto) defaults?: DefaultsDto;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class SubmitDto {
  /** Answers keyed by question id. */
  @IsObject() answers: Record<string, unknown>;
  /** Honeypot: humans never see or fill this field. */
  @IsOptional() @IsString() website?: string;
}

const DEFAULT_QUESTIONS = (): FormQuestion[] => [
  { id: 'title', kind: 'title', label: 'What do you need?', required: true },
  { id: 'description', kind: 'description', label: 'Details', help: 'Steps, links, anything that helps.', required: false },
  { id: 'email', kind: 'email', label: 'Your email', help: 'So we can follow up.', required: false },
];

@Injectable()
export class FormsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tasks: TasksService,
  ) {}

  private repo() {
    return this.dataSource.getRepository(Form);
  }

  async list(orgId: string, projectIdOrKey: string) {
    const project = await findProject(this.dataSource.manager, orgId, projectIdOrKey);
    return (await this.repo().find({ where: { projectId: project.id }, order: { createdAt: 'ASC' } })).map(toFormDto);
  }

  async create(u: AuthPrincipal, projectIdOrKey: string, dto: CreateFormDto) {
    const project = await findProject(this.dataSource.manager, u.organizationId, projectIdOrKey);
    const questions = dto.questions ? await this.questions(project.id, dto.questions) : DEFAULT_QUESTIONS();
    const form = await this.repo().save(
      this.repo().create({
        organizationId: u.organizationId,
        projectId: project.id,
        slug: randomBytes(9).toString('base64url'),
        name: dto.name.trim(),
        description: dto.description ?? '',
        questions,
        defaults: dto.defaults ?? {},
        createdById: u.userId,
      }),
    );
    return toFormDto(form);
  }

  async update(u: AuthPrincipal, id: string, dto: UpdateFormDto) {
    const form = await this.find(u.organizationId, id);
    if (dto.name !== undefined) form.name = dto.name.trim();
    if (dto.description !== undefined) form.description = dto.description;
    if (dto.questions) form.questions = await this.questions(form.projectId, dto.questions);
    if (dto.defaults) form.defaults = dto.defaults;
    if (dto.enabled !== undefined) form.enabled = dto.enabled;
    return toFormDto(await this.repo().save(form));
  }

  async remove(u: AuthPrincipal, id: string) {
    const form = await this.find(u.organizationId, id);
    await this.repo().delete({ id: form.id });
    return { id, deleted: true };
  }

  /** What the public form page renders. Only what a stranger needs: no ids of people or internal data. */
  async publicForm(slug: string) {
    const form = await this.repo().findOneBy({ slug });
    if (!form || !form.enabled) throw ApiException.notFound('form', 'This form is not accepting responses');
    const [project, org, fields] = await Promise.all([
      this.dataSource.getRepository(Project).findOneByOrFail({ id: form.projectId }),
      this.dataSource.getRepository(Organization).findOneByOrFail({ id: form.organizationId }),
      this.dataSource.getRepository(CustomField).find({ where: { projectId: form.projectId } }),
    ]);
    return {
      name: form.name,
      description: form.description,
      organization: org.name,
      project: { name: project.name, color: project.color },
      questions: form.questions
        .map((q) => {
          const field = q.kind === 'field' ? fields.find((f) => f.id === q.fieldId) : null;
          if (q.kind === 'field' && (!field || field.type === 'PERSON')) return null;
          return { id: q.id, kind: q.kind, label: q.label, help: q.help ?? '', required: q.required, field: field ? { type: field.type, options: toFieldDto(field).options } : null };
        })
        .filter(Boolean),
    };
  }

  async submit(slug: string, dto: SubmitDto) {
    const form = await this.repo().findOneBy({ slug });
    if (!form || !form.enabled) throw ApiException.notFound('form', 'This form is not accepting responses');
    // Bots fill every input; pretend it worked so they learn nothing.
    if (dto.website) return { ok: true };
    const a = dto.answers ?? {};
    const text = (q: FormQuestion) => {
      const v = a[q.id];
      return v === undefined || v === null ? '' : String(v).trim();
    };
    const missing = form.questions.filter((q) => q.required && (a[q.id] === undefined || a[q.id] === null || text(q) === '' || (Array.isArray(a[q.id]) && !(a[q.id] as unknown[]).length)));
    if (missing.length) throw ApiException.badRequest('VALIDATION_ERROR', `Please answer: ${missing.map((q) => q.label).join(', ')}`, { missing: missing.map((q) => q.id) });

    const byKind = (k: QuestionKind) => form.questions.find((q) => q.kind === k);
    const title = byKind('title') ? text(byKind('title')!) : '';
    if (!title) throw ApiException.badRequest('VALIDATION_ERROR', 'A title is required');
    const email = byKind('email') ? text(byKind('email')!) : '';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw ApiException.badRequest('VALIDATION_ERROR', 'Please enter a valid email address');
    const name = byKind('name') ? text(byKind('name')!) : '';
    const pick = <T extends string>(k: QuestionKind, allowed: T[]) => {
      const v = byKind(k) ? text(byKind(k)!).toUpperCase() : '';
      return (allowed as string[]).includes(v) ? (v as T) : undefined;
    };
    const due = byKind('dueDate') ? text(byKind('dueDate')!) : '';
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw ApiException.badRequest('VALIDATION_ERROR', 'Dates must be YYYY-MM-DD');

    const customFields: Record<string, unknown> = {};
    for (const q of form.questions) if (q.kind === 'field' && q.fieldId && a[q.id] !== undefined && a[q.id] !== '') customFields[q.fieldId] = a[q.id];

    const who = [name, email && `<${email}>`].filter(Boolean).join(' ');
    const details = byKind('description') ? text(byKind('description')!) : '';
    const description = [details, `---\n_Submitted via form **${form.name}**${who ? ` by ${who}` : ''}._`].filter(Boolean).join('\n\n');

    const principal = await this.principal(form, who || 'Form');
    const task = await this.tasks.create(principal, {
      projectId: form.projectId,
      title: title.slice(0, 500),
      description,
      type: pick('type', Object.values(TaskType)) ?? form.defaults.type,
      priority: pick('priority', Object.values(TaskPriority)) ?? form.defaults.priority,
      stateId: form.defaults.stateId,
      assigneeId: form.defaults.assigneeId,
      labelIds: form.defaults.labelIds,
      dueDate: due || undefined,
      customFields,
    });
    await this.dataSource.query(`UPDATE forms SET submission_count = submission_count + 1, last_submitted_at = now() WHERE id = $1`, [form.id]);
    return { ok: true, key: task.key };
  }

  /** Submissions act as the form's creator (so permissions and audit stay meaningful), shown as "<name> via form". */
  private async principal(form: Form, who: string): Promise<AuthPrincipal> {
    const m = await this.dataSource.getRepository(Membership).findOne({ where: { organizationId: form.organizationId, userId: form.createdById }, relations: { user: true } });
    if (!m) throw ApiException.notFound('form', 'This form is not accepting responses');
    return { userId: m.userId, organizationId: m.organizationId, role: Role.MEMBER, email: m.user.email, name: `${who} via form` };
  }

  private async questions(projectId: string, input: QuestionDto[]): Promise<FormQuestion[]> {
    if (input.filter((q) => q.kind === 'title').length !== 1) throw ApiException.badRequest('INVALID_FORM', 'A form needs exactly one title question');
    const fields = await this.dataSource.getRepository(CustomField).find({ where: { projectId } });
    const seen = new Set<string>();
    return input.map((q, i) => {
      if (q.kind === 'field' && !fields.some((f) => f.id === q.fieldId)) throw ApiException.badRequest('INVALID_FORM', `Question "${q.label}" points at a field that doesn't exist`);
      if (q.kind !== 'field' && q.kind !== 'title' && input.filter((x) => x.kind === q.kind).length > 1) throw ApiException.badRequest('INVALID_FORM', `Only one ${q.kind} question is allowed`);
      let id = q.id || (q.kind === 'field' ? `f_${q.fieldId!.slice(0, 8)}` : q.kind);
      if (seen.has(id)) id = `${id}_${i}`;
      seen.add(id);
      return { id, kind: q.kind, fieldId: q.kind === 'field' ? q.fieldId : undefined, label: q.label.trim(), help: q.help?.trim() || undefined, required: q.kind === 'title' ? true : !!q.required };
    });
  }

  private async find(orgId: string, id: string) {
    const form = await this.repo().findOneBy({ id, organizationId: orgId });
    if (!form) throw ApiException.notFound('form');
    return form;
  }
}

@ApiTags('forms')
@ApiBearerAuth()
@Controller()
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  @Get('projects/:projectId/forms')
  list(@CurrentUser() u: AuthPrincipal, @Param('projectId') projectId: string) {
    return this.forms.list(u.organizationId, projectId);
  }

  @MinRole(Role.MEMBER)
  @Post('projects/:projectId/forms')
  create(@CurrentUser() u: AuthPrincipal, @Param('projectId') projectId: string, @Body() dto: CreateFormDto) {
    return this.forms.create(u, projectId, dto);
  }

  @MinRole(Role.MEMBER)
  @Patch('forms/:id')
  update(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFormDto) {
    return this.forms.update(u, id, dto);
  }

  @MinRole(Role.MEMBER)
  @Delete('forms/:id')
  remove(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.forms.remove(u, id);
  }

  @Public()
  @Get('public/forms/:slug')
  publicForm(@Param('slug') slug: string) {
    return this.forms.publicForm(slug);
  }

  @Public()
  @Post('public/forms/:slug')
  @HttpCode(201)
  submit(@Param('slug') slug: string, @Body() dto: SubmitDto) {
    return this.forms.submit(slug, dto);
  }
}

@Module({ imports: [TasksModule], controllers: [FormsController], providers: [FormsService] })
export class FormsModule {}
