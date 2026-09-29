import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { findProject } from '../projects/projects.service';

/**
 * Roadmap: epics across projects on a time axis. An epic's span defaults to its own
 * start/due dates, falling back to the earliest/latest dates of its child tasks.
 */
@ApiTags('roadmaps')
@ApiBearerAuth()
@Controller('roadmap')
export class RoadmapController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async roadmap(@CurrentUser() u: AuthPrincipal, @Query('projectId') projectId?: string) {
    const project = projectId ? await findProject(this.dataSource.manager, u.organizationId, projectId) : null;
    const rows = await this.dataSource.query(
      `SELECT e.id, e.key, e.title, e.status, e.project_id AS "projectId", p.name AS "projectName", p.color AS "projectColor",
              COALESCE(e.start_date, MIN(c.start_date), MIN(c.due_date)) AS "startDate",
              COALESCE(e.due_date, MAX(c.due_date), MAX(c.start_date)) AS "dueDate",
              COUNT(c.id)::int AS "childCount",
              COUNT(c.id) FILTER (WHERE c.status = 'DONE')::int AS "childDone",
              COALESCE(SUM(c.story_points), 0)::int AS points,
              json_build_object('id', a.id, 'name', a.name) AS assignee
         FROM tasks e
         JOIN projects p ON p.id = e.project_id
         LEFT JOIN tasks c ON c.parent_id = e.id
         LEFT JOIN users a ON a.id = e.assignee_id
        WHERE e.organization_id = $1 AND e.type = 'EPIC' AND ($2::uuid IS NULL OR e.project_id = $2)
        GROUP BY e.id, e.key, e.title, e.status, e.project_id, e.number, e.start_date, e.due_date, p.id, a.id
        ORDER BY "startDate" NULLS LAST, e.number`,
      [u.organizationId, project?.id ?? null],
    );
    return rows.map((r: any) => ({
      ...r,
      startDate: r.startDate ? toDate(r.startDate) : null,
      dueDate: r.dueDate ? toDate(r.dueDate) : null,
      assignee: r.assignee?.id ? r.assignee : null,
      progress: r.childCount ? Math.round((r.childDone / r.childCount) * 100) : r.status === 'DONE' ? 100 : 0,
    }));
  }
}

function toDate(v: string | Date) {
  if (typeof v === 'string') return v.slice(0, 10);
  return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
}

@Module({ controllers: [RoadmapController] })
export class RoadmapModule {}
