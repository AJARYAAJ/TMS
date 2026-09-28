import { Controller, Get, Module, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { findProject } from '../projects/projects.service';
import { Sprint, SprintStatus } from '../sprints/sprint.entity';
import { Task, TaskStatus } from '../tasks/task.entity';
import { toTaskDtos } from '../tasks/tasks.service';

const toCounts = (rows: { key: string; count: number }[]) => Object.fromEntries(rows.map((r) => [r.key, r.count]));

@ApiTags('reports')
@ApiBearerAuth()
@Controller()
export class ReportsController {
  constructor(private readonly dataSource: DataSource) {}

  /** Personal dashboard for the signed-in user. */
  @Get('dashboard')
  async dashboard(@CurrentUser() u: AuthPrincipal) {
    const db = this.dataSource;
    const [[summary], byStatus, upcoming, projects, heatmap, [time]] = await Promise.all([
      db.query(
        `SELECT COUNT(*) FILTER (WHERE status <> 'DONE')::int AS "openTasks",
                COUNT(*) FILTER (WHERE status <> 'DONE' AND due_date < CURRENT_DATE)::int AS "overdue",
                COUNT(*) FILTER (WHERE status <> 'DONE' AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)::int AS "dueThisWeek",
                COUNT(*) FILTER (WHERE status = 'DONE' AND completed_at >= now() - interval '7 days')::int AS "completedThisWeek"
           FROM tasks WHERE organization_id = $1 AND assignee_id = $2`,
        [u.organizationId, u.userId],
      ),
      db.query(`SELECT status AS key, COUNT(*)::int AS count FROM tasks WHERE organization_id = $1 AND assignee_id = $2 GROUP BY status`, [u.organizationId, u.userId]),
      db.getRepository(Task).find({
        where: { organizationId: u.organizationId, assigneeId: u.userId },
        relations: { assignee: true, reporter: true, labels: true, parent: true },
        order: { dueDate: { direction: 'ASC', nulls: 'LAST' }, updatedAt: 'DESC' },
        take: 50,
      }),
      db.query(`SELECT COUNT(*)::int AS count FROM projects WHERE organization_id = $1 AND status = 'ACTIVE'`, [u.organizationId]),
      // Completions per day for the last 12 weeks (contribution heatmap).
      db.query(
        `SELECT to_char(completed_at::date, 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
           FROM tasks WHERE organization_id = $1 AND assignee_id = $2 AND completed_at >= CURRENT_DATE - 83
          GROUP BY 1 ORDER BY 1`,
        [u.organizationId, u.userId],
      ),
      db.query(
        `SELECT COALESCE(SUM(minutes), 0)::int AS "minutesThisWeek" FROM time_entries
          WHERE organization_id = $1 AND user_id = $2 AND started_at >= date_trunc('week', now())`,
        [u.organizationId, u.userId],
      ),
    ]);
    return {
      ...summary,
      activeProjects: projects[0].count,
      byStatus: toCounts(byStatus),
      minutesThisWeek: time.minutesThisWeek,
      heatmap,
      upNext: await toTaskDtos(db.manager, upcoming.filter((t) => t.status !== TaskStatus.DONE).slice(0, 8)),
    };
  }

  /** Project analytics: distribution, workload, sprint progress and completion trend. */
  @Get('projects/:id/reports')
  async project(@CurrentUser() u: AuthPrincipal, @Param('id') id: string) {
    const project = await findProject(this.dataSource.manager, u.organizationId, id);
    const db = this.dataSource;
    const pid = project.id;
    const group = (col: string) => db.query(`SELECT ${col} AS key, COUNT(*)::int AS count FROM tasks WHERE project_id = $1 GROUP BY ${col}`, [pid]);
    const [[totals], byStatus, byPriority, byType, workload, trend, activeSprint, timeByUser] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'DONE')::int AS completed,
                COUNT(*) FILTER (WHERE status <> 'DONE' AND due_date < CURRENT_DATE)::int AS overdue,
                COUNT(*) FILTER (WHERE assignee_id IS NULL AND status <> 'DONE')::int AS unassigned,
                COALESCE(SUM(estimate_minutes), 0)::int AS "estimateMinutes",
                (SELECT COALESCE(SUM(e.minutes), 0) FROM time_entries e JOIN tasks x ON x.id = e.task_id WHERE x.project_id = $1)::int AS "loggedMinutes"
           FROM tasks WHERE project_id = $1`,
        [pid],
      ),
      group('status'),
      group('priority'),
      group('type'),
      db.query(
        `SELECT u.id, u.name, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE t.status <> 'DONE')::int AS open,
                COALESCE(SUM(t.story_points) FILTER (WHERE t.status <> 'DONE'), 0)::int AS "openPoints"
           FROM tasks t JOIN users u ON u.id = t.assignee_id
          WHERE t.project_id = $1 GROUP BY u.id, u.name ORDER BY open DESC, u.name`,
        [pid],
      ),
      db.query(
        `SELECT to_char(d::date, 'YYYY-MM-DD') AS date,
                (SELECT COUNT(*)::int FROM tasks WHERE project_id = $1 AND completed_at::date = d::date) AS completed,
                (SELECT COUNT(*)::int FROM tasks WHERE project_id = $1 AND created_at::date = d::date) AS created
           FROM generate_series(CURRENT_DATE - 13, CURRENT_DATE, interval '1 day') d ORDER BY d`,
        [pid],
      ),
      db.getRepository(Sprint).findOneBy({ projectId: pid, status: SprintStatus.ACTIVE }),
      db.query(
        `SELECT u.id, u.name, COALESCE(SUM(e.minutes), 0)::int AS minutes
           FROM time_entries e JOIN tasks t ON t.id = e.task_id JOIN users u ON u.id = e.user_id
          WHERE t.project_id = $1 AND e.minutes IS NOT NULL GROUP BY u.id, u.name ORDER BY minutes DESC`,
        [pid],
      ),
    ]);
    let sprint = null;
    if (activeSprint) {
      const [s] = await db.query(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'DONE')::int AS done,
                COALESCE(SUM(story_points), 0)::int AS points, COALESCE(SUM(story_points) FILTER (WHERE status = 'DONE'), 0)::int AS "donePoints"
           FROM tasks WHERE sprint_id = $1`,
        [activeSprint.id],
      );
      sprint = { id: activeSprint.id, name: activeSprint.name, startDate: activeSprint.startDate, endDate: activeSprint.endDate, ...s };
    }
    return {
      projectId: pid,
      ...totals,
      byStatus: toCounts(byStatus),
      byPriority: toCounts(byPriority),
      byType: toCounts(byType),
      workload,
      trend,
      activeSprint: sprint,
      timeByUser,
    };
  }
}

@Module({ controllers: [ReportsController] })
export class ReportsModule {}
