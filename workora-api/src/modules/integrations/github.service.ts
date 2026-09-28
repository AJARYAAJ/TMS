import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { DataSource } from 'typeorm';
import { AuthPrincipal } from '../../common/auth/principal';
import { EventBus } from '../../common/events/event-bus.service';
import { ApiException } from '../../common/http/api-exception';
import { APP_CONFIG, AppConfig } from '../../config';
import { findProject } from '../projects/projects.service';
import { Task, TaskStatus, TaskType } from '../tasks/task.entity';
import { taskDto, TasksService } from '../tasks/tasks.service';
import { ExternalLink, GithubConfig, Integration, LinkKind, toLinkDto } from './integration.entity';
import { CATEGORY_RANK, closingKeys, extractKeys, integrationPrincipal, tasksByKeys, touch } from './shared';

interface LinkInput {
  kind: LinkKind;
  externalId: string;
  url: string;
  title: string;
  state: string | null;
  author: string | null;
}

/**
 * GitHub: a signed webhook receiver. Anything mentioning a task key (PR title/body/branch,
 * commit message, issue) is linked to that task; PR and keyword events move tasks through
 * the workflow; issues can become tasks.
 */
@Injectable()
export class GithubService {
  private readonly logger = new Logger('GitHub');

  constructor(
    private readonly dataSource: DataSource,
    private readonly tasks: TasksService,
    private readonly events: EventBus,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** `X-Hub-Signature-256: sha256=HMAC_SHA256(secret, rawBody)` */
  verify(secret: string, signature: string | undefined, raw: Buffer) {
    const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
    const given = Buffer.from(signature ?? '');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new ApiException(401, 'INVALID_SIGNATURE', 'Invalid GitHub signature');
  }

  async handle(integration: Integration, event: string, payload: any) {
    const c = integration.config as GithubConfig;
    const repo: string | undefined = payload.repository?.full_name;
    if (event === 'ping') {
      await touch(this.dataSource, integration.id, 'ping');
      return { ok: true, pong: true };
    }
    if (c.repository && repo && repo.toLowerCase() !== c.repository.toLowerCase()) return { ignored: 'repository not configured' };
    const principal = await integrationPrincipal(this.dataSource, integration, `${payload.sender?.login ?? 'GitHub'} via GitHub`);
    if (!principal) return { ignored: 'integration owner left the organization' };

    let result: Record<string, unknown>;
    switch (event) {
      case 'pull_request':
        result = await this.pullRequest(integration, principal, payload);
        break;
      case 'push':
        result = await this.push(integration, principal, payload);
        break;
      case 'issues':
        result = await this.issue(integration, principal, payload);
        break;
      default:
        result = { ignored: `event ${event}` };
    }
    await touch(this.dataSource, integration.id, event);
    return result;
  }

  private async pullRequest(i: Integration, p: AuthPrincipal, body: any) {
    const c = i.config as GithubConfig;
    const pr = body.pull_request;
    const repo = body.repository.full_name;
    const keys = extractKeys(pr.title, pr.body, pr.head?.ref);
    const tasks = await tasksByKeys(this.dataSource, i.organizationId, keys);
    const state = pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : pr.draft ? 'draft' : 'open';
    const linked: string[] = [];
    for (const t of tasks) {
      await this.link(i, p, t, { kind: 'pull_request', externalId: `${repo}#${pr.number}`, url: pr.html_url, title: `#${pr.number} ${pr.title}`, state, author: pr.user?.login ?? null });
      linked.push(t.key);
      if (state === 'open' && ['opened', 'reopened', 'ready_for_review'].includes(body.action) && c.onPrOpened) await this.advance(p, t, c.onPrOpened);
      if (state === 'merged' && c.onPrMerged !== null) await this.advance(p, t, c.onPrMerged ?? TaskStatus.DONE);
    }
    return { linked };
  }

  private async push(i: Integration, p: AuthPrincipal, body: any) {
    const c = i.config as GithubConfig;
    const repo = body.repository.full_name;
    const onDefault = body.ref === `refs/heads/${body.repository.default_branch}`;
    const linked = new Set<string>();
    const closed = new Set<string>();
    const branchKeys = extractKeys(String(body.ref ?? '').replace('refs/heads/', ''));
    for (const commit of body.commits ?? []) {
      const keys = [...new Set([...extractKeys(commit.message), ...branchKeys])];
      for (const t of await tasksByKeys(this.dataSource, i.organizationId, keys)) {
        await this.link(i, p, t, { kind: 'commit', externalId: `${repo}@${commit.id}`, url: commit.url, title: `${commit.id.slice(0, 7)} ${String(commit.message).split('\n')[0]}`.slice(0, 250), state: null, author: commit.author?.username ?? commit.author?.name ?? null });
        linked.add(t.key);
      }
      if (onDefault && c.closeOnKeywords) {
        for (const t of await tasksByKeys(this.dataSource, i.organizationId, closingKeys(commit.message))) {
          await this.advance(p, t, TaskStatus.DONE);
          closed.add(t.key);
        }
      }
    }
    return { linked: [...linked], closed: [...closed] };
  }

  private async issue(i: Integration, p: AuthPrincipal, body: any) {
    const c = i.config as GithubConfig;
    const issue = body.issue;
    const repo = body.repository.full_name;
    const link = { kind: 'issue' as const, externalId: `${repo}#${issue.number}`, url: issue.html_url, title: `#${issue.number} ${issue.title}`, state: issue.state, author: issue.user?.login ?? null };

    // Issues that already have a task (created from it, or mentioning a key) stay in sync.
    const existing = await this.dataSource.getRepository(ExternalLink).find({ where: { organizationId: i.organizationId, provider: 'github', kind: 'issue', externalId: link.externalId } });
    const mentioned = await tasksByKeys(this.dataSource, i.organizationId, extractKeys(issue.title, issue.body));
    const taskIds = new Set([...existing.map((l) => l.taskId), ...mentioned.map((t) => t.id)]);

    if (body.action === 'opened' && !taskIds.size && c.createTasksFromIssues && c.projectId) {
      const project = await findProject(this.dataSource.manager, i.organizationId, c.projectId);
      const isBug = (issue.labels ?? []).some((l: any) => /bug/i.test(l.name ?? ''));
      const created = await this.tasks.create(p, {
        projectId: project.id,
        title: issue.title.slice(0, 500),
        description: `${issue.body ?? ''}\n\n— [${repo}#${issue.number}](${issue.html_url}) opened by @${issue.user?.login}`.trim(),
        type: isBug ? TaskType.BUG : TaskType.TASK,
      });
      const task = await this.dataSource.getRepository(Task).findOneByOrFail({ id: created.id });
      await this.link(i, p, task, link);
      return { created: created.key };
    }

    const synced: string[] = [];
    for (const id of taskIds) {
      const t = await this.dataSource.getRepository(Task).findOneBy({ id });
      if (!t) continue;
      await this.link(i, p, t, link);
      if (body.action === 'closed' && c.closeOnKeywords) await this.advance(p, t, TaskStatus.DONE);
      synced.push(t.key);
    }
    return { synced };
  }

  /** Upsert a link and broadcast it (activity log, realtime, Slack). */
  private async link(i: Integration, p: AuthPrincipal, t: Task, input: LinkInput) {
    const repo = this.dataSource.getRepository(ExternalLink);
    const where = { taskId: t.id, provider: 'github', kind: input.kind, externalId: input.externalId };
    const current = await repo.findOneBy(where);
    if (current && current.state === input.state && current.title === input.title) return current;
    const saved = await repo.save(current ? Object.assign(current, input) : repo.create({ ...where, ...input, organizationId: i.organizationId }));
    const task = await this.dataSource.getRepository(Task).findOneOrFail({ where: { id: t.id }, relations: { assignee: true, reporter: true, labels: true, parent: true, state: true } });
    this.events.publish('DEV_LINKED', {
      organizationId: i.organizationId,
      projectId: t.projectId,
      actor: { id: p.userId, name: p.name },
      data: { task: await taskDto(this.dataSource.manager, task), link: toLinkDto(saved), isNew: !current },
    });
    return saved;
  }

  /** Move forward only: a merged PR never drags a finished task back into review. */
  private async advance(p: AuthPrincipal, t: Task, target: string) {
    const fresh = await this.dataSource.getRepository(Task).findOneBy({ id: t.id });
    if (!fresh) return;
    const category = (Object.keys(CATEGORY_RANK).includes(target) ? target : null) as TaskStatus | null;
    if (category) {
      if (CATEGORY_RANK[category] <= CATEGORY_RANK[fresh.status]) return;
      await this.tasks.update(p, t.id, { status: category }).catch((e) => this.logger.warn(`Could not move ${t.key}: ${e.message}`));
    } else {
      await this.tasks.update(p, t.id, { stateId: target }).catch((e) => this.logger.warn(`Could not move ${t.key}: ${e.message}`));
    }
  }
}
