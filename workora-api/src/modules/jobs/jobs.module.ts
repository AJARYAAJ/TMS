import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Job, Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { DOMAIN_EVENT, DomainEvent } from '../../common/events/domain-events';
import { EventBus } from '../../common/events/event-bus.service';
import { Sprint } from '../sprints/sprint.entity';
import { toSprintDto } from '../sprints/sprints.module';
import { Task } from '../tasks/task.entity';
import { toTaskDtos } from '../tasks/tasks.service';
import { In } from 'typeorm';
import { EmailModule, EmailService, NotificationEmailJob } from '../email/email.module';
import { JobNames, JOBS_QUEUE, ProjectSetupJob } from './jobs.constants';

/** Kicks off background work in response to domain events so API responses stay fast. */
@Injectable()
export class JobScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(JOBS_QUEUE) private readonly queue: Queue) {}

  /** Recurring job: remind assignees about overdue work every 15 minutes. */
  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler('overdue-scan', { every: 15 * 60_000 }, { name: JobNames.OVERDUE_SCAN, opts: { removeOnComplete: 50, removeOnFail: 50 } });
    // Trash retention: tasks stay restorable for 30 days.
    await this.queue.upsertJobScheduler('trash-purge', { every: 6 * 60 * 60_000 }, { name: JobNames.TRASH_PURGE, opts: { removeOnComplete: 20, removeOnFail: 20 } });
  }

  @OnEvent(DOMAIN_EVENT, { async: true })
  async onEvent(e: DomainEvent) {
    if (e.type === 'PROJECT_CREATED') {
      await this.queue.add(JobNames.PROJECT_SETUP, { organizationId: e.organizationId, projectId: e.projectId! } satisfies ProjectSetupJob, {
        jobId: `project-setup-${e.projectId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    }
  }

  /** Retries transient SMTP failures with backoff (2s, 4s, 8s, 16s); 5xx rejections fail at once. */
  enqueueEmail(mail: NotificationEmailJob) {
    return this.queue.add(JobNames.NOTIFICATION_EMAIL, mail, { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 });
  }
}

@Processor(JOBS_QUEUE)
export class JobsProcessor extends WorkerHost {
  private readonly logger = new Logger(JobsProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly email: EmailService,
  ) {
    super();
  }

  async process(job: Job) {
    switch (job.name) {
      case JobNames.PROJECT_SETUP:
        return this.setupProject(job.data as ProjectSetupJob);
      case JobNames.NOTIFICATION_EMAIL:
        return this.email.deliver(job.data as NotificationEmailJob, job.attemptsMade + 1, job.opts.attempts ?? 1);
      case JobNames.OVERDUE_SCAN:
        return this.scanOverdue();
      case JobNames.TRASH_PURGE:
        return this.purgeTrash();
      default:
        this.logger.warn(`Unknown job ${job.name}`);
    }
  }

  /**
   * Marks newly overdue tasks and publishes TASK_OVERDUE once per task (reset when the due
   * date changes). Notifications and "when overdue" automations subscribe to that event.
   */
  async scanOverdue() {
    const rows: [{ id: string }[], number] = await this.dataSource.query(
      `UPDATE tasks SET overdue_notified_at = now()
        WHERE status <> 'DONE' AND due_date < CURRENT_DATE AND overdue_notified_at IS NULL
        RETURNING id`,
    );
    const ids = (Array.isArray(rows[0]) ? rows[0] : (rows as any)).map((r: { id: string }) => r.id);
    if (!ids.length) return { overdue: 0 };
    const tasks = await this.dataSource.getRepository(Task).find({ where: { id: In(ids) }, relations: { assignee: true, reporter: true, labels: true, parent: true } });
    for (const task of await toTaskDtos(this.dataSource.manager, tasks)) {
      const t = tasks.find((x) => x.id === task.id)!;
      this.events.publish('TASK_OVERDUE', { organizationId: t.organizationId, projectId: t.projectId, actor: null, data: { task } });
    }
    return { overdue: ids.length };
  }

  /** Permanently removes tasks that have been in the trash for more than 30 days. */
  async purgeTrash() {
    const [, purged] = await this.dataSource.query(`DELETE FROM tasks_all WHERE deleted_at < now() - interval '30 days'`);
    return { purged };
  }

  /** Default project scaffolding: the first sprint (board columns come from the default workflow). */
  private async setupProject({ organizationId, projectId }: ProjectSetupJob) {
    const repo = this.dataSource.getRepository(Sprint);
    if (await repo.existsBy({ projectId })) return { skipped: true };
    const sprint = await repo.save(repo.create({ organizationId, projectId, name: 'Sprint 1', goal: '' }));
    this.events.publish('SPRINT_CREATED', { organizationId, projectId, actor: null, data: { sprint: toSprintDto(sprint) } });
    return { sprintId: sprint.id };
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: JOBS_QUEUE }), EmailModule],
  providers: [JobScheduler, JobsProcessor],
  exports: [JobScheduler],
})
export class JobsModule {}
