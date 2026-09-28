import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Between, DataSource, EntityManager, IsNull } from 'typeorm';
import { CurrentUser, MinRole } from '../../common/auth/decorators';
import { actorOf, AuthPrincipal } from '../../common/auth/principal';
import { hasRole, Role } from '../../common/auth/roles';
import { EventBus } from '../../common/events/event-bus.service';
import { ApiException } from '../../common/http/api-exception';
import { addWatchers, findTask } from '../tasks/tasks.service';
import { toUserSummary } from '../users/user.entity';
import { TimeEntry } from './time-entry.entity';

class LogTimeDto {
  @IsInt() @Min(1) @Max(24 * 60) minutes: number;
  /** Day the work happened (defaults to today). */
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class StartTimerDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class TimesheetQuery {
  @IsOptional() @Matches(/^(me|[0-9a-fA-F-]{36})$/) userId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

const MAX_TIMER_MINUTES = 12 * 60;

function toEntryDto(e: TimeEntry) {
  const running = !e.endedAt;
  return {
    id: e.id,
    taskId: e.taskId,
    task: e.task ? { id: e.task.id, key: e.task.key, title: e.task.title, projectId: e.task.projectId } : undefined,
    user: toUserSummary(e.user),
    startedAt: e.startedAt,
    endedAt: e.endedAt,
    minutes: running ? Math.floor((Date.now() - e.startedAt.getTime()) / 60000) : e.minutes,
    running,
    note: e.note,
  };
}

/** Time tracking: live timers (one per user) and manual time logs, aggregated into timesheets. */
@Injectable()
export class TimeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  async running(u: AuthPrincipal) {
    const e = await this.dataSource.getRepository(TimeEntry).findOne({ where: { userId: u.userId, organizationId: u.organizationId, endedAt: IsNull() }, relations: { task: true, user: true } });
    return e ? toEntryDto(e) : null;
  }

  async start(u: AuthPrincipal, taskIdOrKey: string, note = '') {
    const entry = await this.dataSource.transaction(async (m) => {
      const task = await findTask(m, u.organizationId, taskIdOrKey);
      await this.stopRunning(m, u);
      const saved = await m.save(m.create(TimeEntry, { organizationId: u.organizationId, taskId: task.id, userId: u.userId, startedAt: new Date(), note }));
      await addWatchers(m, task.id, [u.userId]);
      return m.findOneOrFail(TimeEntry, { where: { id: saved.id }, relations: { task: true, user: true } });
    });
    return toEntryDto(entry);
  }

  async stop(u: AuthPrincipal) {
    const stopped = await this.dataSource.transaction((m) => this.stopRunning(m, u));
    if (!stopped) throw ApiException.badRequest('NO_RUNNING_TIMER', 'You have no running timer');
    this.published(u, stopped);
    return toEntryDto(stopped);
  }

  async log(u: AuthPrincipal, taskIdOrKey: string, dto: LogTimeDto) {
    const entry = await this.dataSource.transaction(async (m) => {
      const task = await findTask(m, u.organizationId, taskIdOrKey);
      const day = dto.date ? new Date(`${dto.date}T09:00:00`) : new Date(Date.now() - dto.minutes * 60000);
      const saved = await m.save(
        m.create(TimeEntry, { organizationId: u.organizationId, taskId: task.id, userId: u.userId, startedAt: day, endedAt: new Date(day.getTime() + dto.minutes * 60000), minutes: dto.minutes, note: dto.note ?? '' }),
      );
      return m.findOneOrFail(TimeEntry, { where: { id: saved.id }, relations: { task: true, user: true } });
    });
    this.published(u, entry);
    return toEntryDto(entry);
  }

  async forTask(orgId: string, taskIdOrKey: string) {
    const task = await findTask(this.dataSource.manager, orgId, taskIdOrKey);
    const rows = await this.dataSource.getRepository(TimeEntry).find({ where: { taskId: task.id }, relations: { user: true }, order: { startedAt: 'DESC' } });
    return rows.map(toEntryDto);
  }

  /** Entries in a date range with per-day and per-task totals. */
  async timesheet(u: AuthPrincipal, q: TimesheetQuery) {
    const userId = !q.userId || q.userId === 'me' ? u.userId : q.userId;
    if (userId !== u.userId && !hasRole(u.role, Role.ADMIN)) throw ApiException.forbidden("Only admins can view other people's timesheets");
    const to = q.to ? new Date(`${q.to}T23:59:59.999`) : new Date();
    const from = q.from ? new Date(`${q.from}T00:00:00`) : new Date(to.getTime() - 6 * 86400000);
    const rows = await this.dataSource.getRepository(TimeEntry).find({
      where: { organizationId: u.organizationId, userId, startedAt: Between(from, to) },
      relations: { task: true, user: true },
      order: { startedAt: 'DESC' },
    });
    const entries = rows.map(toEntryDto);
    const byDay: Record<string, number> = {};
    for (const e of entries) {
      const d = new Date(e.startedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      byDay[key] = (byDay[key] ?? 0) + (e.minutes ?? 0);
    }
    return { userId, from, to, totalMinutes: entries.reduce((n, e) => n + (e.minutes ?? 0), 0), byDay, entries };
  }

  async remove(u: AuthPrincipal, id: string) {
    const repo = this.dataSource.getRepository(TimeEntry);
    const e = await repo.findOneBy({ id, organizationId: u.organizationId });
    if (!e) throw ApiException.notFound('time_entry');
    if (e.userId !== u.userId && !hasRole(u.role, Role.ADMIN)) throw ApiException.forbidden('You can only delete your own time entries');
    await repo.delete({ id });
    return { id, deleted: true };
  }

  private async stopRunning(m: EntityManager, u: AuthPrincipal) {
    const running = await m.findOne(TimeEntry, { where: { userId: u.userId, endedAt: IsNull() }, relations: { task: true, user: true } });
    if (!running) return null;
    running.endedAt = new Date();
    running.minutes = Math.max(1, Math.min(MAX_TIMER_MINUTES, Math.round((running.endedAt.getTime() - running.startedAt.getTime()) / 60000)));
    return m.save(running);
  }

  private published(u: AuthPrincipal, e: TimeEntry) {
    this.events.publish('TIME_LOGGED', {
      organizationId: u.organizationId,
      projectId: e.task.projectId,
      actor: actorOf(u),
      data: { entry: toEntryDto(e), task: { id: e.task.id, key: e.task.key, title: e.task.title } },
    });
  }
}

@ApiTags('time-entries')
@ApiBearerAuth()
@Controller()
export class TimeController {
  constructor(private readonly time: TimeService) {}

  @Get('timer')
  running(@CurrentUser() u: AuthPrincipal) {
    return this.time.running(u);
  }

  /** Starts a timer on the task (stopping any other running timer first). */
  @MinRole(Role.MEMBER)
  @Post('tasks/:id/timer')
  start(@CurrentUser() u: AuthPrincipal, @Param('id') id: string, @Body() dto: StartTimerDto) {
    return this.time.start(u, id, dto.note);
  }

  @MinRole(Role.MEMBER)
  @HttpCode(200)
  @Post('timer/stop')
  stop(@CurrentUser() u: AuthPrincipal) {
    return this.time.stop(u);
  }

  @Get('tasks/:id/time-entries')
  forTask(@CurrentUser() u: AuthPrincipal, @Param('id') id: string) {
    return this.time.forTask(u.organizationId, id);
  }

  @MinRole(Role.MEMBER)
  @Post('tasks/:id/time-entries')
  log(@CurrentUser() u: AuthPrincipal, @Param('id') id: string, @Body() dto: LogTimeDto) {
    return this.time.log(u, id, dto);
  }

  @Get('time-entries')
  timesheet(@CurrentUser() u: AuthPrincipal, @Query() q: TimesheetQuery) {
    return this.time.timesheet(u, q);
  }

  @MinRole(Role.MEMBER)
  @Delete('time-entries/:id')
  remove(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.time.remove(u, id);
  }
}

@Module({ controllers: [TimeController], providers: [TimeService] })
export class TimeModule {}
