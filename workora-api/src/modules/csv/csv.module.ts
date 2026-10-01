import { Body, Controller, Get, HttpCode, Injectable, Module, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { DataSource, In } from 'typeorm';
import { CurrentUser, MinRole } from '../../common/auth/decorators';
import { actorOf, AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { EventBus } from '../../common/events/event-bus.service';
import { ApiException } from '../../common/http/api-exception';
import { CustomField, FieldType } from '../fields/custom-field.entity';
import { normaliseValue } from '../fields/field-values';
import { Label } from '../labels/label.entity';
import { Membership } from '../organizations/membership.entity';
import { findProject } from '../projects/projects.service';
import { Sprint } from '../sprints/sprint.entity';
import { Task, TaskPriority, TaskType } from '../tasks/task.entity';
import { TasksModule } from '../tasks/tasks.module';
import { CreateTaskDto } from '../tasks/tasks.dto';
import { TasksService } from '../tasks/tasks.service';
import { WorkflowState } from '../workflow/workflow-state.entity';
import { parseCsv, parseDate, toCsv } from './csv';

const MAX_ROWS = 1000;

/** Import targets. Custom fields are `field:<id>`. */
const TARGETS = ['title', 'description', 'type', 'status', 'priority', 'assignee', 'labels', 'storyPoints', 'estimateHours', 'startDate', 'dueDate', 'parent', 'ignore'] as const;

/** Header names used by Jira, Asana, Trello, ClickUp, Linear and Monday exports. */
const SYNONYMS: Record<string, (typeof TARGETS)[number]> = {
  title: 'title', summary: 'title', name: 'title', 'task name': 'title', 'card name': 'title', subject: 'title', task: 'title',
  description: 'description', notes: 'description', details: 'description', 'card description': 'description', body: 'description',
  type: 'type', 'issue type': 'type', 'task type': 'type',
  status: 'status', state: 'status', column: 'status', section: 'status', 'section/column': 'status', list: 'status', stage: 'status',
  priority: 'priority',
  assignee: 'assignee', 'assignee email': 'assignee', 'assigned to': 'assignee', owner: 'assignee', 'assignee name': 'assignee',
  labels: 'labels', label: 'labels', tags: 'labels',
  'story points': 'storyPoints', 'story point estimate': 'storyPoints', points: 'storyPoints', estimate: 'storyPoints',
  'estimate (h)': 'estimateHours', 'estimate hours': 'estimateHours', 'original estimate': 'estimateHours', 'time estimate': 'estimateHours', 'estimated hours': 'estimateHours',
  'start date': 'startDate', 'start on': 'startDate', start: 'startDate',
  'due date': 'dueDate', due: 'dueDate', 'due on': 'dueDate', deadline: 'dueDate',
  parent: 'parent', 'parent key': 'parent', 'parent id': 'parent', epic: 'parent', 'epic link': 'parent', 'parent task': 'parent',
};

const TYPE_WORDS: Record<string, TaskType> = { bug: TaskType.BUG, defect: TaskType.BUG, story: TaskType.STORY, 'user story': TaskType.STORY, epic: TaskType.EPIC, task: TaskType.TASK, 'sub-task': TaskType.TASK, subtask: TaskType.TASK, feature: TaskType.STORY };
const PRIORITY_WORDS: Record<string, TaskPriority> = {
  highest: TaskPriority.URGENT, blocker: TaskPriority.URGENT, critical: TaskPriority.URGENT, urgent: TaskPriority.URGENT, p0: TaskPriority.URGENT,
  high: TaskPriority.HIGH, major: TaskPriority.HIGH, p1: TaskPriority.HIGH,
  medium: TaskPriority.MEDIUM, normal: TaskPriority.MEDIUM, p2: TaskPriority.MEDIUM,
  low: TaskPriority.LOW, lowest: TaskPriority.LOW, minor: TaskPriority.LOW, trivial: TaskPriority.LOW, p3: TaskPriority.LOW,
};
const CATEGORY_WORDS: Record<string, string> = {
  'to do': 'TODO', todo: 'TODO', open: 'TODO', backlog: 'TODO', new: 'TODO', 'not started': 'TODO', selected: 'TODO',
  'in progress': 'IN_PROGRESS', doing: 'IN_PROGRESS', active: 'IN_PROGRESS', started: 'IN_PROGRESS', 'working on it': 'IN_PROGRESS',
  'in review': 'IN_REVIEW', review: 'IN_REVIEW', 'code review': 'IN_REVIEW', qa: 'IN_REVIEW', testing: 'IN_REVIEW',
  done: 'DONE', closed: 'DONE', resolved: 'DONE', complete: 'DONE', completed: 'DONE',
};

class ImportDto {
  @IsString() @MaxLength(4_000_000) csv: string;
  /** Column header → target (`title`, `dueDate`, `field:<id>`, `ignore`…). Omitted columns are auto-mapped. */
  @IsOptional() @IsObject() mapping?: Record<string, string>;
  /** Validate and preview without creating anything. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

@Injectable()
export class CsvService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tasks: TasksService,
    private readonly events: EventBus,
  ) {}

  async export(orgId: string, projectIdOrKey: string) {
    const m = this.dataSource.manager;
    const project = await findProject(m, orgId, projectIdOrKey);
    const [tasks, fields, sprints] = await Promise.all([
      m.find(Task, { where: { projectId: project.id }, relations: { assignee: true, reporter: true, labels: true, parent: true, state: true }, order: { number: 'ASC' } }),
      m.find(CustomField, { where: { projectId: project.id }, order: { position: 'ASC' } }),
      m.find(Sprint, { where: { projectId: project.id } }),
    ]);
    const people = new Map<string, string>(
      (await m.query(`SELECT u.id, u.email FROM memberships ms JOIN users u ON u.id = ms.user_id WHERE ms.organization_id = $1`, [orgId])).map((r: any) => [r.id, r.email]),
    );
    const fieldValue = (f: CustomField, v: unknown) => {
      if (v === undefined || v === null) return '';
      if (f.type === FieldType.SELECT) return f.options.find((o) => o.id === v)?.label ?? '';
      if (f.type === FieldType.MULTI_SELECT) return (v as string[]).map((id) => f.options.find((o) => o.id === id)?.label).filter(Boolean).join('; ');
      if (f.type === FieldType.PERSON) return people.get(v as string) ?? '';
      return String(v);
    };
    const header = ['Key', 'Title', 'Type', 'Status', 'Status category', 'Priority', 'Assignee', 'Reporter', 'Sprint', 'Parent', 'Labels', 'Story points', 'Estimate (h)', 'Start date', 'Due date', 'Created', 'Completed', 'Description', ...fields.map((f) => f.name)];
    const rows = tasks.map((t) => [
      t.key,
      t.title,
      t.type,
      t.state?.name ?? t.status,
      t.status,
      t.priority,
      t.assignee?.email ?? '',
      t.reporter?.email ?? '',
      sprints.find((s) => s.id === t.sprintId)?.name ?? '',
      t.parent?.key ?? '',
      t.labels.map((l) => l.name).join('; '),
      t.storyPoints ?? '',
      t.estimateMinutes != null ? Math.round((t.estimateMinutes / 60) * 100) / 100 : '',
      t.startDate ?? '',
      t.dueDate ?? '',
      t.createdAt.toISOString(),
      t.completedAt?.toISOString() ?? '',
      t.description,
      ...fields.map((f) => fieldValue(f, t.customValues?.[f.id])),
    ]);
    return { filename: `${project.key}-tasks-${new Date().toISOString().slice(0, 10)}.csv`, body: toCsv(header, rows) };
  }

  async import(u: AuthPrincipal, projectIdOrKey: string, dto: ImportDto) {
    const m = this.dataSource.manager;
    const project = await findProject(m, u.organizationId, projectIdOrKey);
    const table = parseCsv(dto.csv);
    if (table.length < 2) throw ApiException.badRequest('EMPTY_CSV', 'The file needs a header row and at least one task');
    const [header, ...body] = table;
    if (body.length > MAX_ROWS) throw ApiException.badRequest('TOO_MANY_ROWS', `Import at most ${MAX_ROWS} rows at a time (this file has ${body.length})`);

    const [fields, states, labels, members] = await Promise.all([
      m.find(CustomField, { where: { projectId: project.id } }),
      m.find(WorkflowState, { where: { projectId: project.id }, order: { position: 'ASC' } }),
      m.find(Label, { where: { organizationId: u.organizationId } }),
      m.find(Membership, { where: { organizationId: u.organizationId }, relations: { user: true } }),
    ]);

    // Column mapping: explicit choices win, otherwise match header names (and custom field names).
    const mapping: Record<string, string> = {};
    const used = new Set<string>();
    for (const col of header) {
      const explicit = dto.mapping?.[col];
      const norm = col.trim().toLowerCase();
      const field = fields.find((f) => f.name.toLowerCase() === norm);
      let target = explicit ?? (field ? `field:${field.id}` : SYNONYMS[norm]) ?? 'ignore';
      if (target !== 'ignore' && !explicit && used.has(target)) target = 'ignore';
      if (!(TARGETS as readonly string[]).includes(target) && !(target.startsWith('field:') && fields.some((f) => `field:${f.id}` === target))) {
        throw ApiException.badRequest('INVALID_MAPPING', `Unknown target "${target}" for column "${col}"`);
      }
      mapping[col] = target;
      used.add(target);
    }
    if (!Object.values(mapping).includes('title')) throw ApiException.badRequest('TITLE_REQUIRED', 'Map one column to Title', { columns: header, mapping });

    const findMember = (v: string) => {
      const s = v.trim().toLowerCase();
      return members.find((ms) => ms.user.email.toLowerCase() === s) ?? members.find((ms) => ms.user.name.toLowerCase() === s);
    };
    // Parents can be existing tasks (by key) or other rows of this file, via its own key column (e.g. Jira's "Issue key").
    const parentCol = header.findIndex((h) => mapping[h] === 'parent');
    const fileKeyCol = header.findIndex((h) => ['key', 'issue key', 'task id', 'id'].includes(h.trim().toLowerCase()));
    const parentKeys = parentCol >= 0 ? [...new Set(body.map((r) => (r[parentCol] ?? '').trim().toUpperCase()).filter(Boolean))] : [];
    const existingParents = new Map<string, string>();
    if (parentKeys.length) {
      for (const t of await m.find(Task, { where: { organizationId: u.organizationId, projectId: project.id, key: In(parentKeys) } })) existingParents.set(t.key, t.id);
    }

    const newLabels = new Set<string>();
    const rows = body.map((cells, index) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const out: Record<string, any> = { customFields: {} as Record<string, unknown> };
      let parentKey: string | null = null;
      header.forEach((col, i) => {
        const raw = (cells[i] ?? '').trim();
        const target = mapping[col];
        if (!raw || target === 'ignore') return;
        switch (target) {
          case 'title':
            out.title = raw.slice(0, 500);
            break;
          case 'description':
            out.description = raw;
            break;
          case 'type':
            out.type = TYPE_WORDS[raw.toLowerCase()] ?? (warnings.push(`type "${raw}" → Task`), TaskType.TASK);
            break;
          case 'priority':
            out.priority = PRIORITY_WORDS[raw.toLowerCase()] ?? (warnings.push(`priority "${raw}" → Medium`), TaskPriority.MEDIUM);
            break;
          case 'status': {
            const state = states.find((st) => st.name.toLowerCase() === raw.toLowerCase()) ?? states.find((st) => st.category === CATEGORY_WORDS[raw.toLowerCase()]);
            if (state) out.stateId = state.id;
            else warnings.push(`status "${raw}" → ${states[0]?.name}`);
            break;
          }
          case 'assignee': {
            const member = findMember(raw);
            if (member) out.assigneeId = member.userId;
            else warnings.push(`assignee "${raw}" is not a member; left unassigned`);
            break;
          }
          case 'labels': {
            const names = raw.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
            out.labelNames = names;
            for (const n of names) if (!labels.some((l) => l.name.toLowerCase() === n.toLowerCase())) newLabels.add(n);
            break;
          }
          case 'storyPoints': {
            const n = Number(raw);
            if (Number.isInteger(n) && n >= 0 && n <= 1000) out.storyPoints = n;
            else errors.push(`story points "${raw}" is not a whole number`);
            break;
          }
          case 'estimateHours': {
            const n = Number(raw.replace(/h$/i, ''));
            if (Number.isFinite(n) && n >= 0) out.estimateMinutes = Math.round(n * 60);
            else errors.push(`estimate "${raw}" is not a number of hours`);
            break;
          }
          case 'startDate':
          case 'dueDate': {
            const d = parseDate(raw);
            if (d) out[target] = d;
            else errors.push(`${target === 'dueDate' ? 'due' : 'start'} date "${raw}" is not a date`);
            break;
          }
          case 'parent':
            parentKey = raw.toUpperCase();
            break;
          default:
            out.customFields[target.slice(6)] = raw;
        }
      });
      if (!out.title) errors.push('title is empty');
      const fileKey = fileKeyCol >= 0 ? (cells[fileKeyCol] ?? '').trim().toUpperCase() || null : null;
      return { row: index + 2, data: out, parentKey, fileKey, errors, warnings };
    });

    // Custom field values are validated the same way the API does, without writing anything.
    for (const r of rows) {
      for (const [fieldId, raw] of Object.entries(r.data.customFields)) {
        const field = fields.find((f) => f.id === fieldId)!;
        try {
          if (field.type === FieldType.PERSON) {
            const member = findMember(String(raw));
            if (!member) throw new Error(`${field.name}: "${raw}" is not a member`);
            r.data.customFields[fieldId] = member.userId;
          } else r.data.customFields[fieldId] = normaliseValue(field, raw);
        } catch (e: any) {
          r.errors.push(e.message);
        }
      }
    }

    const valid = rows.filter((r) => !r.errors.length);
    const preview = {
      columns: header,
      mapping,
      targets: [...TARGETS, ...fields.map((f) => `field:${f.id}`)],
      fields: fields.map((f) => ({ id: f.id, name: f.name, type: f.type })),
      total: rows.length,
      valid: valid.length,
      newLabels: [...newLabels],
      problems: rows.filter((r) => r.errors.length || r.warnings.length).slice(0, 50).map((r) => ({ row: r.row, errors: r.errors, warnings: r.warnings })),
      sample: rows.slice(0, 5).map((r) => ({ row: r.row, title: r.data.title ?? '', ok: !r.errors.length })),
    };
    if (dto.dryRun) return { ...preview, created: 0 };

    // Create missing labels, then tasks (through TasksService, so validation, events and automations apply).
    const labelIds = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));
    for (const name of newLabels) {
      const saved = await m.getRepository(Label).save(m.getRepository(Label).create({ organizationId: u.organizationId, name: name.slice(0, 40), color: '#64748b' }));
      labelIds.set(name.toLowerCase(), saved.id);
    }
    const createdKeys: string[] = [];
    const failed: { row: number; message: string }[] = [];
    const idByRow = new Map<number, string>();
    const idByFileKey = new Map<string, string>();
    for (const r of valid) {
      const { labelNames, ...data } = r.data;
      try {
        const task = await this.tasks.create(u, {
          ...(data as Omit<CreateTaskDto, 'projectId'>),
          projectId: project.id,
          labelIds: labelNames ? [...new Set<string>(labelNames.map((n: string) => labelIds.get(n.toLowerCase())!))] : undefined,
        });
        createdKeys.push(task.key);
        idByRow.set(r.row, task.id);
        if (r.fileKey) idByFileKey.set(r.fileKey, task.id);
      } catch (e: any) {
        failed.push({ row: r.row, message: e?.message ?? 'Failed' });
      }
    }
    for (const r of valid) {
      const id = idByRow.get(r.row);
      const parentId = r.parentKey ? (idByFileKey.get(r.parentKey) ?? existingParents.get(r.parentKey)) : undefined;
      if (!id || !parentId) continue;
      await this.tasks.update(u, id, { parentId }).catch((e) => failed.push({ row: r.row, message: `parent ${r.parentKey}: ${e?.message}` }));
    }
    this.events.publish('TASKS_IMPORTED', { organizationId: u.organizationId, projectId: project.id, actor: actorOf(u), data: { count: createdKeys.length, first: createdKeys[0], last: createdKeys.at(-1) } });
    return { ...preview, created: createdKeys.length, keys: createdKeys, failed };
  }
}

@ApiTags('import / export')
@ApiBearerAuth()
@Controller('projects/:projectId')
export class CsvController {
  constructor(private readonly csv: CsvService) {}

  /** Downloads every live task in the project as CSV (UTF-8 with BOM, Excel-friendly). */
  @Get('export.csv')
  async export(@CurrentUser() u: AuthPrincipal, @Param('projectId') projectId: string, @Res() res: Response) {
    const { filename, body } = await this.csv.export(u.organizationId, projectId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  }

  /** Preview (`dryRun: true`) or run an import of tasks from CSV. */
  @MinRole(Role.MEMBER)
  @Post('import')
  @HttpCode(200)
  import(@CurrentUser() u: AuthPrincipal, @Param('projectId') projectId: string, @Body() dto: ImportDto) {
    return this.csv.import(u, projectId, dto);
  }
}

@Module({ imports: [TasksModule], controllers: [CsvController], providers: [CsvService] })
export class CsvModule {}
