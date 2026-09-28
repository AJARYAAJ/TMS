import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Job, Queue } from 'bullmq';
import { createHmac, timingSafeEqual } from 'crypto';
import { DataSource } from 'typeorm';
import { DOMAIN_EVENT, DomainEvent } from '../../common/events/domain-events';
import { ApiException } from '../../common/http/api-exception';
import { APP_CONFIG, AppConfig } from '../../config';
import { findProject } from '../projects/projects.service';
import { TasksService } from '../tasks/tasks.service';
import { Integration, SlackConfig } from './integration.entity';
import { integrationPrincipal, taskUrl, touch } from './shared';

export const INTEGRATIONS_QUEUE = 'workora-integrations';

/** Events a Slack channel can subscribe to. TASK_UPDATED only posts when a task changes state. */
export const SLACK_EVENTS = ['TASK_CREATED', 'TASK_UPDATED', 'TASK_ASSIGNED', 'COMMENT_CREATED', 'SPRINT_STARTED', 'SPRINT_COMPLETED', 'TASK_OVERDUE', 'DEV_LINKED', 'DOCUMENT_CREATED'];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface SlackMessage {
  text: string;
  blocks?: unknown[];
  response_type?: 'ephemeral' | 'in_channel';
}

/** Turns a domain event into a Slack Block Kit message (null = nothing worth posting). */
export function slackMessageFor(e: DomainEvent, appUrl: string): SlackMessage | null {
  const who = esc(e.actor?.name ?? 'Workora');
  const d = e.data;
  const link = (t: { key: string; title: string }) => `<${taskUrl(appUrl, t.key)}|${t.key} ${esc(t.title)}>`;
  let text: string | null = null;
  let context: string | null = null;
  switch (e.type) {
    case 'TASK_CREATED':
      text = `🆕 *${who}* created ${link(d.task)}`;
      context = [d.task.priority && `Priority: ${d.task.priority.toLowerCase()}`, d.task.assignee && `Assignee: ${esc(d.task.assignee.name)}`].filter(Boolean).join(' · ');
      break;
    case 'TASK_UPDATED':
      if (!d.changes?.state && !d.changes?.status) return null;
      text = `${d.task.status === 'DONE' ? '✅' : '➡️'} *${who}* moved ${link(d.task)} to *${esc(d.changes.state?.to ?? d.task.state?.name ?? d.task.status)}*`;
      break;
    case 'TASK_ASSIGNED':
      text = `👤 *${who}* assigned ${link(d.task)} to *${esc(d.task.assignee?.name ?? 'nobody')}*`;
      break;
    case 'COMMENT_CREATED':
      text = `💬 *${who}* commented on ${link(d.task)}\n>${esc(d.comment.body).slice(0, 400).replace(/\n/g, '\n>')}`;
      break;
    case 'SPRINT_STARTED':
      text = `🚀 *${who}* started *${esc(d.sprint.name)}*${d.sprint.goal ? ` — _${esc(d.sprint.goal)}_` : ''}`;
      break;
    case 'SPRINT_COMPLETED':
      text = `🏁 *${esc(d.sprint.name)}* completed${d.movedToBacklog ? ` · ${d.movedToBacklog} unfinished task(s) returned to the backlog` : ''}`;
      break;
    case 'TASK_OVERDUE':
      text = `⏰ ${link(d.task)} is overdue${d.task.assignee ? ` (assigned to ${esc(d.task.assignee.name)})` : ''}`;
      break;
    case 'DEV_LINKED':
      if (d.link.kind !== 'pull_request') return null;
      text = `${d.link.state === 'merged' ? '🟣 Merged' : d.link.state === 'closed' ? '⚪ Closed' : '🟢 Opened'} <${d.link.url}|${esc(d.link.title)}> for ${link(d.task)}`;
      break;
    case 'DOCUMENT_CREATED':
      text = `📄 *${who}* created the doc *${esc(d.document.title)}*`;
      break;
    default:
      return null;
  }
  const blocks: unknown[] = [{ type: 'section', text: { type: 'mrkdwn', text } }];
  if (context) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: context }] });
  return { text: text.replace(/[*_]/g, ''), blocks };
}

/**
 * Slack: posts workspace events to channels via Incoming Webhooks (queued, retried) and answers
 * the `/workora` slash command. Slash-command requests are verified with Slack's signing secret.
 */
@Injectable()
export class SlackService {
  private readonly logger = new Logger('Slack');

  constructor(
    private readonly dataSource: DataSource,
    private readonly tasks: TasksService,
    @InjectQueue(INTEGRATIONS_QUEUE) private readonly queue: Queue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @OnEvent(DOMAIN_EVENT, { async: true })
  async onEvent(e: DomainEvent) {
    if (!SLACK_EVENTS.includes(e.type)) return;
    const integrations = await this.dataSource.getRepository(Integration).find({ where: { organizationId: e.organizationId, provider: 'slack', enabled: true } });
    for (const i of integrations) {
      const c = i.config as SlackConfig;
      if (!c.webhookUrl || !c.events?.includes(e.type)) continue;
      if (c.projectId && e.projectId !== c.projectId) continue;
      const message = slackMessageFor(e, this.config.appUrl);
      if (!message) continue;
      await this.queue.add('slack.post', { integrationId: i.id, message }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 200, removeOnFail: 500 });
    }
  }

  async sendTest(integration: Integration) {
    const message: SlackMessage = { text: '👋 Workora is connected to this channel.', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `👋 *Workora* is connected. You'll see ${(integration.config as SlackConfig).events.length} kinds of updates here.` } }] };
    await this.queue.add('slack.post', { integrationId: integration.id, message }, { attempts: 1, removeOnComplete: 50, removeOnFail: 50 });
  }

  /** Verifies `X-Slack-Signature: v0=HMAC_SHA256(secret, "v0:{timestamp}:{body}")` and freshness. */
  verify(secret: string, timestamp: string | undefined, signature: string | undefined, raw: string) {
    const ts = Number(timestamp);
    if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) throw new ApiException(401, 'INVALID_SIGNATURE', 'Stale or missing Slack timestamp');
    const expected = Buffer.from(`v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${raw}`).digest('hex')}`);
    const given = Buffer.from(signature ?? '');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new ApiException(401, 'INVALID_SIGNATURE', 'Invalid Slack signature');
  }

  /** `/workora help | create [KEY:] title | search text | KEY-123` */
  async command(integration: Integration, form: URLSearchParams): Promise<SlackMessage> {
    const text = (form.get('text') ?? '').trim();
    const slackUser = form.get('user_name') ?? 'someone';
    const [verb, ...rest] = text.split(/\s+/);
    const arg = rest.join(' ').trim();
    const orgId = integration.organizationId;
    await touch(this.dataSource, integration.id, 'command');

    if (!text || /^help$/i.test(verb)) {
      return this.reply(
        [
          '*Workora commands*',
          '`/workora create Fix checkout timeout` — create a task' + ((integration.config as SlackConfig).commandProjectId ? '' : ' (prefix with a project key: `ECOM: …`)'),
          '`/workora ECOM-12` — show a task',
          '`/workora search payment` — find tasks',
        ].join('\n'),
      );
    }

    if (/^[A-Za-z][A-Za-z0-9]{1,9}-\d+$/.test(verb)) {
      try {
        const t = await this.tasks.get(orgId, verb.toUpperCase());
        const url = taskUrl(this.config.appUrl, t.key);
        return {
          response_type: 'in_channel',
          text: `${t.key} ${t.title}`,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `*<${url}|${t.key} ${esc(t.title)}>*\n${esc(t.description.slice(0, 280))}` } },
            {
              type: 'context',
              elements: [
                { type: 'mrkdwn', text: `*${esc(t.state?.name ?? t.status)}* · ${t.priority.toLowerCase()} · ${t.assignee ? esc(t.assignee.name) : 'unassigned'}${t.dueDate ? ` · due ${t.dueDate}` : ''}` },
              ],
            },
          ],
        };
      } catch {
        return this.reply(`I couldn't find ${verb.toUpperCase()}.`);
      }
    }

    if (/^(search|find)$/i.test(verb)) {
      if (arg.length < 2) return this.reply('Give me at least two characters to search for.');
      const rows = await this.dataSource.query(
        `SELECT key, title, status FROM tasks WHERE organization_id = $1 AND (title ILIKE $2 OR key ILIKE $2) ORDER BY updated_at DESC LIMIT 5`,
        [orgId, `%${arg.replace(/[\\%_]/g, (c) => `\\${c}`)}%`],
      );
      if (!rows.length) return this.reply(`No tasks match “${esc(arg)}”.`);
      return this.reply(rows.map((r: { key: string; title: string; status: string }) => `• <${taskUrl(this.config.appUrl, r.key)}|${r.key}> ${esc(r.title)} — _${r.status.replace('_', ' ').toLowerCase()}_`).join('\n'));
    }

    if (/^(create|new|add)$/i.test(verb)) {
      let title = arg;
      let projectId = (integration.config as SlackConfig).commandProjectId ?? null;
      const prefixed = title.match(/^([A-Za-z][A-Za-z0-9]{1,9}):\s*(.+)$/);
      if (prefixed) {
        projectId = prefixed[1].toUpperCase();
        title = prefixed[2];
      }
      if (!title) return this.reply('What should the task be called? `/workora create Fix checkout timeout`');
      if (!projectId) return this.reply('Which project? Prefix the title with a project key, e.g. `/workora create ECOM: Fix checkout timeout`.');
      const principal = await integrationPrincipal(this.dataSource, integration, `${slackUser} via Slack`);
      if (!principal) return this.reply('This Slack integration is no longer linked to an active Workora admin.');
      try {
        const project = await findProject(this.dataSource.manager, orgId, projectId);
        const t = await this.tasks.create(principal, { projectId: project.id, title: title.slice(0, 500), description: `Created from Slack by @${slackUser}` });
        return { response_type: 'in_channel', text: `Created ${t.key}`, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `🆕 *${esc(slackUser)}* created <${taskUrl(this.config.appUrl, t.key)}|${t.key} ${esc(t.title)}>` } }] };
      } catch (e: any) {
        return this.reply(`Couldn't create the task: ${esc(e?.message ?? 'unknown error')}`);
      }
    }

    return this.reply(`Unknown command “${esc(verb)}”. Try \`/workora help\`.`);
  }

  private reply(text: string): SlackMessage {
    return { response_type: 'ephemeral', text };
  }
}

@Processor(INTEGRATIONS_QUEUE)
export class IntegrationsProcessor extends WorkerHost {
  private readonly logger = new Logger('SlackDelivery');

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async process(job: Job<{ integrationId: string; message: SlackMessage }>) {
    const i = await this.dataSource.getRepository(Integration).findOneBy({ id: job.data.integrationId });
    const url = (i?.config as SlackConfig | undefined)?.webhookUrl;
    if (!i || !i.enabled || !url) return { skipped: true };
    let error: string | null = null;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job.data.message), signal: AbortSignal.timeout(5000), redirect: 'manual' });
      if (!res.ok) error = `Slack responded ${res.status}: ${(await res.text()).slice(0, 120)}`;
    } catch (e: any) {
      error = e?.name === 'TimeoutError' ? 'Timed out after 5s' : (e?.message ?? 'Delivery failed');
    }
    await touch(this.dataSource, i.id, error ? 'error' : 'delivered', error);
    if (error) {
      this.logger.warn(`${i.name}: ${error}`);
      throw new Error(error);
    }
    return { delivered: true };
  }
}
