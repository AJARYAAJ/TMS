import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { hasRole, Role } from '../../common/auth/roles';
import { ApiException } from '../../common/http/api-exception';
import { Membership } from '../organizations/membership.entity';
import { findProject } from '../projects/projects.service';
import { Sprint, SprintStatus } from '../sprints/sprint.entity';

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => iso(new Date(parse(s).getTime() + n * DAY));
/** Monday of the week containing `s`. */
const weekStart = (s: string) => {
  const d = parse(s);
  return addDays(s, -((d.getUTCDay() + 6) % 7));
};
const isWeekday = (s: string) => {
  const day = parse(s).getUTCDay();
  return day !== 0 && day !== 6;
};

class CapacityDto {
  @IsInt() @Min(0) @Max(80) hoursPerWeek: number;
}

export interface WorkloadTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
  priority: string;
  dueDate: string | null;
  startDate: string | null;
  minutes: number;
  overdue: boolean;
  /** Minutes allocated to each week of the window. */
  weeks: number[];
}

/**
 * Spreads a task's estimate evenly over the working days from its start date (or due date) to its
 * due date. Work scheduled before the window (including overdue work) lands in the first week.
 * Tasks without a due date are "unscheduled".
 */
export function allocate(t: { estimateMinutes: number | null; startDate: string | null; dueDate: string | null }, from: string, weeks: number): number[] | null {
  if (!t.dueDate) return null;
  const out = new Array(weeks).fill(0);
  const minutes = t.estimateMinutes ?? 0;
  if (!minutes) return out;
  const end = t.dueDate;
  const start = t.startDate && t.startDate <= end ? t.startDate : end;
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) if (isWeekday(d)) days.push(d);
  if (!days.length) days.push(end);
  const per = minutes / days.length;
  const windowEnd = addDays(from, weeks * 7);
  for (const d of days) {
    if (d >= windowEnd) continue;
    const idx = d < from ? 0 : Math.floor((parse(d).getTime() - parse(from).getTime()) / (7 * DAY));
    out[idx] += per;
  }
  return out.map((m) => Math.round(m));
}

@ApiTags('insights')
@ApiBearerAuth()
@Controller()
export class InsightsController {
  constructor(private readonly dataSource: DataSource) {}

  /** Remaining work per day of a sprint against the ideal line (story points, or task count when unpointed). */
  @Get('sprints/:id/burndown')
  async burndown(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    const sprint = await this.dataSource.getRepository(Sprint).findOneBy({ id, organizationId: u.organizationId });
    if (!sprint) throw ApiException.notFound('sprint');
    const tasks: { points: number | null; completed: string | null }[] = await this.dataSource.query(
      `SELECT story_points AS points, CASE WHEN status = 'DONE' THEN to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') END AS completed
         FROM tasks WHERE sprint_id = $1`,
      [sprint.id],
    );
    const hasPoints = tasks.some((t) => (t.points ?? 0) > 0) || (sprint.completionStats?.committedPoints ?? 0) > 0;
    const value = (t: { points: number | null }) => (hasPoints ? (t.points ?? 0) : 1);
    // A completed sprint's unfinished work went back to the backlog; its committed total comes from the snapshot.
    const total =
      sprint.status === SprintStatus.COMPLETED && sprint.completionStats
        ? hasPoints
          ? sprint.completionStats.committedPoints
          : sprint.completionStats.committedCount
        : tasks.reduce((n, t) => n + value(t), 0);
    const start = sprint.startDate ?? iso(sprint.createdAt);
    const end = sprint.endDate && sprint.endDate >= start ? sprint.endDate : addDays(start, 13);
    const today = iso(new Date());
    const length = Math.round((parse(end).getTime() - parse(start).getTime()) / DAY);
    const days = [];
    for (let i = 0, d = start; d <= end; i++, d = addDays(d, 1)) {
      const done = tasks.filter((t) => t.completed && t.completed <= d).reduce((n, t) => n + value(t), 0);
      days.push({ date: d, ideal: Math.round((total - (total * i) / Math.max(length, 1)) * 10) / 10, remaining: d <= today ? Math.max(total - done, 0) : null });
    }
    return { sprintId: sprint.id, name: sprint.name, status: sprint.status, unit: hasPoints ? 'points' : 'tasks', total, startDate: start, endDate: end, days };
  }

  /** Committed vs. completed for the project's last completed sprints. */
  @Get('projects/:id/velocity')
  async velocity(@CurrentUser() u: AuthPrincipal, @Param('id') id: string) {
    const project = await findProject(this.dataSource.manager, u.organizationId, id);
    const sprints = await this.dataSource.getRepository(Sprint).find({ where: { projectId: project.id, status: SprintStatus.COMPLETED }, order: { completedAt: 'DESC' }, take: 8 });
    const rows = sprints.reverse().map((s) => ({ id: s.id, name: s.name, completedAt: s.completedAt, stats: s.completionStats }));
    const hasPoints = rows.some((r) => (r.stats?.committedPoints ?? 0) > 0);
    const sprintsOut = rows.map((r) => ({
      id: r.id,
      name: r.name,
      completedAt: r.completedAt,
      committed: (hasPoints ? r.stats?.committedPoints : r.stats?.committedCount) ?? 0,
      completed: (hasPoints ? r.stats?.completedPoints : r.stats?.completedCount) ?? 0,
    }));
    const recent = sprintsOut.slice(-3);
    return {
      unit: hasPoints ? 'points' : 'tasks',
      sprints: sprintsOut,
      average: recent.length ? Math.round((recent.reduce((n, s) => n + s.completed, 0) / recent.length) * 10) / 10 : 0,
    };
  }

  /** People × weeks: estimated hours of open work against each member's weekly capacity. */
  @Get('workload')
  async workload(@CurrentUser() u: AuthPrincipal, @Query('projectId') projectId?: string, @Query('from') fromParam?: string, @Query('weeks') weeksParam?: string) {
    const project = projectId ? await findProject(this.dataSource.manager, u.organizationId, projectId) : null;
    const weeks = Math.min(Math.max(Number(weeksParam) || 6, 1), 12);
    if (fromParam && !/^\d{4}-\d{2}-\d{2}$/.test(fromParam)) throw ApiException.badRequest('VALIDATION_ERROR', 'from must be YYYY-MM-DD');
    const from = weekStart(fromParam ?? iso(new Date()));
    const today = iso(new Date());
    const [members, tasks] = await Promise.all([
      this.dataSource.query(
        `SELECT u.id, u.name, u.email, m.weekly_capacity_minutes AS capacity FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.organization_id = $1 AND m.role <> 'VIEWER' ORDER BY u.name`,
        [u.organizationId],
      ),
      this.dataSource.query(
        `SELECT id, key, title, project_id AS "projectId", priority, assignee_id AS "assigneeId", estimate_minutes AS "estimateMinutes",
                to_char(start_date, 'YYYY-MM-DD') AS "startDate", to_char(due_date, 'YYYY-MM-DD') AS "dueDate"
           FROM tasks WHERE organization_id = $1 AND status <> 'DONE' AND type <> 'EPIC' AND ($2::uuid IS NULL OR project_id = $2)
          ORDER BY due_date NULLS LAST, number`,
        [u.organizationId, project?.id ?? null],
      ),
    ]);
    const people = members.map((mem: any) => {
      const own = tasks.filter((t: any) => t.assigneeId === mem.id);
      const rows: WorkloadTask[] = [];
      const totals = new Array(weeks).fill(0).map(() => ({ minutes: 0, count: 0 }));
      const unscheduled = { minutes: 0, count: 0 };
      for (const t of own) {
        const alloc = allocate(t, from, weeks);
        if (!alloc) {
          unscheduled.minutes += t.estimateMinutes ?? 0;
          unscheduled.count++;
        } else {
          alloc.forEach((m, i) => {
            totals[i].minutes += m;
            if (m > 0) totals[i].count++;
          });
        }
        rows.push({ id: t.id, key: t.key, title: t.title, projectId: t.projectId, priority: t.priority, dueDate: t.dueDate, startDate: t.startDate, minutes: t.estimateMinutes ?? 0, overdue: !!t.dueDate && t.dueDate < today, weeks: alloc ?? [] });
      }
      return {
        user: { id: mem.id, name: mem.name, email: mem.email },
        capacityMinutes: mem.capacity,
        weeks: totals,
        unscheduled,
        unestimated: own.filter((t: any) => !t.estimateMinutes).length,
        openTasks: own.length,
        tasks: rows,
      };
    });
    const unassigned = tasks.filter((t: any) => !t.assigneeId);
    return {
      from,
      weeks: Array.from({ length: weeks }, (_, i) => addDays(from, i * 7)),
      people,
      unassigned: { count: unassigned.length, minutes: unassigned.reduce((n: number, t: any) => n + (t.estimateMinutes ?? 0), 0) },
    };
  }

  /** Members set their own capacity; admins set anyone's. */
  @Patch('workload/capacity/:userId')
  async capacity(@CurrentUser() u: AuthPrincipal, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: CapacityDto) {
    if (userId !== u.userId && !hasRole(u.role, Role.ADMIN)) throw ApiException.forbidden('Only admins can change other members’ capacity');
    const result = await this.dataSource.getRepository(Membership).update({ organizationId: u.organizationId, userId }, { weeklyCapacityMinutes: dto.hoursPerWeek * 60 });
    if (!result.affected) throw ApiException.notFound('member');
    return { userId, capacityMinutes: dto.hoursPerWeek * 60 };
  }
}

@Module({ controllers: [InsightsController] })
export class InsightsModule {}
