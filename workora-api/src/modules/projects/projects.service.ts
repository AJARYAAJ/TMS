import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { actorOf, AuthPrincipal } from '../../common/auth/principal';
import { FieldChange } from '../../common/events/domain-events';
import { EventBus } from '../../common/events/event-bus.service';
import { ApiException } from '../../common/http/api-exception';
import { isUuid } from '../../common/http/identifiers';
import { Task, TaskStatus } from '../tasks/task.entity';
import { Project, ProjectStatus } from './project.entity';
import { CreateProjectDto, toProjectDto, UpdateProjectDto } from './projects.dto';

export async function findProject(m: EntityManager, orgId: string, idOrKey: string) {
  const where = isUuid(idOrKey) ? { id: idOrKey, organizationId: orgId } : { key: idOrKey.toUpperCase(), organizationId: orgId };
  const project = await m.findOne(Project, { where, relations: { owner: true } });
  if (!project) throw ApiException.notFound('project');
  return project;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  private async favoriteIds(userId?: string) {
    if (!userId) return new Set<string>();
    const rows: { project_id: string }[] = await this.dataSource.query('SELECT project_id FROM favorites WHERE user_id = $1', [userId]);
    return new Set(rows.map((r) => r.project_id));
  }

  async list(orgId: string, status?: ProjectStatus, userId?: string) {
    const projects = await this.dataSource.getRepository(Project).find({
      where: { organizationId: orgId, ...(status ? { status } : {}) },
      relations: { owner: true },
      order: { name: 'ASC' },
    });
    const [counts, favorites] = await Promise.all([this.taskCounts(orgId), this.favoriteIds(userId)]);
    return projects.map((p) => toProjectDto(p, counts.get(p.id), favorites.has(p.id)));
  }

  async get(orgId: string, idOrKey: string, userId?: string) {
    const project = await findProject(this.dataSource.manager, orgId, idOrKey);
    const [counts, favorites] = await Promise.all([this.taskCounts(orgId, project.id), this.favoriteIds(userId)]);
    return toProjectDto(project, counts.get(project.id), favorites.has(project.id));
  }

  async create(principal: AuthPrincipal, dto: CreateProjectDto) {
    const project = await this.dataSource.transaction(async (m) => {
      const key = dto.key ?? (await this.suggestKey(m, principal.organizationId, dto.name));
      if (await m.existsBy(Project, { organizationId: principal.organizationId, key })) {
        throw ApiException.conflict('PROJECT_KEY_TAKEN', `Project key ${key} is already in use`);
      }
      const saved = await m.save(
        m.create(Project, {
          organizationId: principal.organizationId,
          key,
          name: dto.name.trim(),
          description: dto.description ?? '',
          color: dto.color ?? '#6366f1',
          ownerId: principal.userId,
        }),
      );
      return findProject(m, principal.organizationId, saved.id);
    });
    const dto$ = toProjectDto(project);
    this.events.publish('PROJECT_CREATED', { organizationId: principal.organizationId, projectId: project.id, actor: actorOf(principal), data: dto$ });
    return dto$;
  }

  async update(principal: AuthPrincipal, idOrKey: string, dto: UpdateProjectDto) {
    const { project, changes } = await this.dataSource.transaction(async (m) => {
      const project = await findProject(m, principal.organizationId, idOrKey);
      const changes: Record<string, FieldChange> = {};
      for (const field of ['name', 'description', 'color', 'status'] as const) {
        if (dto[field] !== undefined && dto[field] !== project[field]) {
          changes[field] = { from: project[field], to: dto[field] };
          (project as any)[field] = dto[field];
        }
      }
      if (Object.keys(changes).length) await m.save(project);
      return { project, changes };
    });
    const dto$ = await this.get(principal.organizationId, project.id, principal.userId);
    if (Object.keys(changes).length) {
      this.events.publish('PROJECT_UPDATED', { organizationId: principal.organizationId, projectId: project.id, actor: actorOf(principal), data: { project: dto$, changes } });
    }
    return dto$;
  }

  private async suggestKey(m: EntityManager, orgId: string, name: string) {
    const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    let base = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? 'PRJ');
    base = base.replace(/^[0-9]+/, '').slice(0, 6);
    if (base.length < 2) base = (base + 'PRJ').slice(0, 3);
    let key = base;
    for (let i = 2; await m.existsBy(Project, { organizationId: orgId, key }); i++) key = `${base.slice(0, 8)}${i}`;
    return key;
  }

  private async taskCounts(orgId: string, projectId?: string) {
    const qb = this.dataSource
      .getRepository(Task)
      .createQueryBuilder('t')
      .select('t.project_id', 'projectId')
      .addSelect('COUNT(*)::int', 'total')
      .addSelect(`COUNT(*) FILTER (WHERE t.status <> '${TaskStatus.DONE}')::int`, 'open')
      .where('t.organization_id = :orgId', { orgId })
      .groupBy('t.project_id');
    if (projectId) qb.andWhere('t.project_id = :projectId', { projectId });
    const rows = await qb.getRawMany<{ projectId: string; total: number; open: number }>();
    return new Map(rows.map((r) => [r.projectId, { total: r.total, open: r.open }]));
  }
}
