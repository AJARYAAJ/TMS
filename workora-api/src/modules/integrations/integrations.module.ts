import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { HttpCode, Req } from '@nestjs/common';
import type { Request } from 'express';
import { IsIn } from 'class-validator';
import { Public } from '../../common/auth/decorators';
import { TasksModule } from '../tasks/tasks.module';
import { findProject } from '../projects/projects.service';
import { GithubService } from './github.service';
import { GithubConfig, Integration, SlackConfig } from './integration.entity';
import { IntegrationsProcessor, INTEGRATIONS_QUEUE, SLACK_EVENTS, SlackService } from './slack.service';
import { Body, Controller, Delete, Get, Inject, Injectable, Logger, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Job, Queue } from 'bullmq';
import { IsArray, IsBoolean, IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength } from 'class-validator';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { TaskStatus } from '../tasks/task.entity';
import { RawJson } from '../../common/http/api-response';
import { DataSource } from 'typeorm';
import { CurrentUser, MinRole } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { DOMAIN_EVENT, DomainEvent } from '../../common/events/domain-events';
import { ApiException } from '../../common/http/api-exception';
import { APP_CONFIG, AppConfig } from '../../config';
import { Webhook, WebhookDelivery } from './webhook.entity';

export const WEBHOOK_QUEUE = 'workora-webhooks';

class WebhookDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true }) url: string;
  @IsOptional() @IsArray() @IsString({ each: true }) events?: string[];
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class UpdateWebhookDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true }) url?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) events?: string[];
  @IsOptional() @IsBoolean() enabled?: boolean;
}

interface DeliveryJob {
  webhookId: string;
  event: Omit<DomainEvent, 'organizationId'> & { organizationId: string };
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$)/i;

const toDto = (w: Webhook) => ({ id: w.id, name: w.name, url: w.url, events: w.events, enabled: w.enabled, createdAt: w.createdAt });

export function sign(secret: string, body: string) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

@Injectable()
export class WebhooksService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue(WEBHOOK_QUEUE) private readonly queue: Queue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(orgId: string) {
    const hooks = await this.dataSource.getRepository(Webhook).find({ where: { organizationId: orgId }, order: { createdAt: 'ASC' } });
    const stats = await this.dataSource.query(
      `SELECT DISTINCT ON (webhook_id) webhook_id AS "webhookId", success, status_code AS "statusCode", created_at AS "at"
         FROM webhook_deliveries WHERE webhook_id = ANY($1) ORDER BY webhook_id, created_at DESC`,
      [hooks.map((h) => h.id)],
    );
    const last = new Map(stats.map((s: any) => [s.webhookId, s]));
    return hooks.map((h) => ({ ...toDto(h), lastDelivery: last.get(h.id) ?? null }));
  }

  async create(orgId: string, dto: WebhookDto) {
    this.assertAllowed(dto.url);
    const secret = `whsec_${randomBytes(24).toString('hex')}`;
    const repo = this.dataSource.getRepository(Webhook);
    const saved = await repo.save(repo.create({ organizationId: orgId, name: dto.name.trim(), url: dto.url, secret, events: dto.events?.length ? dto.events : ['*'], enabled: dto.enabled ?? true }));
    // The signing secret is only revealed once, at creation.
    return { ...toDto(saved), secret };
  }

  async update(orgId: string, id: string, dto: UpdateWebhookDto) {
    const repo = this.dataSource.getRepository(Webhook);
    const hook = await repo.findOneBy({ id, organizationId: orgId });
    if (!hook) throw ApiException.notFound('webhook');
    if (dto.url) this.assertAllowed(dto.url);
    Object.assign(hook, Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)));
    return toDto(await repo.save(hook));
  }

  async remove(orgId: string, id: string) {
    const result = await this.dataSource.getRepository(Webhook).delete({ id, organizationId: orgId });
    if (!result.affected) throw ApiException.notFound('webhook');
    return { id, deleted: true };
  }

  async deliveries(orgId: string, id: string) {
    if (!(await this.dataSource.getRepository(Webhook).existsBy({ id, organizationId: orgId }))) throw ApiException.notFound('webhook');
    return this.dataSource.getRepository(WebhookDelivery).find({ where: { webhookId: id }, order: { createdAt: 'DESC' }, take: 50 });
  }

  async test(u: AuthPrincipal, id: string) {
    if (!(await this.dataSource.getRepository(Webhook).existsBy({ id, organizationId: u.organizationId }))) throw ApiException.notFound('webhook');
    const event = { id: randomUUID(), type: 'PING', organizationId: u.organizationId, actor: { id: u.userId, name: u.name }, occurredAt: new Date().toISOString(), data: { message: 'Hello from Workora' } };
    await this.queue.add('deliver', { webhookId: id, event } as DeliveryJob, { attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
    return { queued: true, eventId: event.id };
  }

  /** Fan every committed domain event out to the organization's subscribed webhooks. */
  @OnEvent(DOMAIN_EVENT, { async: true })
  async onEvent(e: DomainEvent) {
    const hooks = await this.dataSource
      .getRepository(Webhook)
      .createQueryBuilder('w')
      .where('w.organization_id = :org AND w.enabled AND (w.events @> :all OR w.events @> :type)', { org: e.organizationId, all: JSON.stringify(['*']), type: JSON.stringify([e.type]) })
      .getMany();
    for (const h of hooks) {
      await this.queue.add('deliver', { webhookId: h.id, event: e } as DeliveryJob, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      });
    }
  }

  private assertAllowed(url: string) {
    if (this.config.webhookAllowPrivate) return;
    if (PRIVATE_HOST.test(new URL(url).hostname)) throw ApiException.badRequest('WEBHOOK_URL_NOT_ALLOWED', 'Webhook URLs must be publicly reachable');
  }
}

/** Delivers webhook payloads with an HMAC signature; failures are retried with backoff. */
@Processor(WEBHOOK_QUEUE)
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger('Webhooks');

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async process(job: Job<DeliveryJob>) {
    const hook = await this.dataSource.getRepository(Webhook).createQueryBuilder('w').addSelect('w.secret').where('w.id = :id', { id: job.data.webhookId }).getOne();
    if (!hook || !hook.enabled) return { skipped: true };
    const body = JSON.stringify(job.data.event);
    const started = Date.now();
    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(5000),
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Workora-Webhooks/1.0',
          'X-Workora-Event': job.data.event.type,
          'X-Workora-Delivery': job.data.event.id,
          'X-Workora-Signature': sign(hook.secret, body),
        },
      });
      statusCode = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e: any) {
      error = e?.name === 'TimeoutError' ? 'Timed out after 5s' : (e?.message ?? 'Delivery failed');
    }
    await this.dataSource.getRepository(WebhookDelivery).insert({
      webhookId: hook.id,
      eventId: job.data.event.id,
      eventType: job.data.event.type,
      attempt: job.attemptsMade + 1,
      statusCode,
      success: !error,
      durationMs: Date.now() - started,
      error: error?.slice(0, 250) ?? null,
    });
    if (error) {
      this.logger.warn(`Delivery to ${hook.url} failed (${error}), attempt ${job.attemptsMade + 1}`);
      throw new Error(error);
    }
    return { statusCode };
  }
}

@ApiTags('integrations')
@ApiBearerAuth()
@MinRole(Role.ADMIN)
@Controller('integrations/webhooks')
export class WebhooksController {
  constructor(private readonly hooks: WebhooksService) {}

  @Get()
  list(@CurrentUser() u: AuthPrincipal) {
    return this.hooks.list(u.organizationId);
  }

  @Post()
  create(@CurrentUser() u: AuthPrincipal, @Body() dto: WebhookDto) {
    return this.hooks.create(u.organizationId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWebhookDto) {
    return this.hooks.update(u.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.hooks.remove(u.organizationId, id);
  }

  @Get(':id/deliveries')
  deliveries(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.hooks.deliveries(u.organizationId, id);
  }

  @Post(':id/test')
  test(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.hooks.test(u, id);
  }
}

/* ───────────── Slack & GitHub (first-party integrations) ───────────── */

class SlackIntegrationDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true }) webhookUrl?: string | null;
  @IsOptional() @IsString() projectId?: string | null;
  @IsOptional() @IsArray() @IsIn(SLACK_EVENTS, { each: true }) events?: string[];
  @IsOptional() @IsString() commandProjectId?: string | null;
  /** Slack app "Signing Secret" — enables the /workora slash command. */
  @IsOptional() @IsString() @MinLength(8) @MaxLength(200) signingSecret?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class GithubIntegrationDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @Matches(/^[\w.-]+\/[\w.-]+$/, { message: 'repository must look like owner/name' }) repository?: string | null;
  @IsOptional() @IsString() projectId?: string | null;
  @IsOptional() @IsBoolean() createTasksFromIssues?: boolean;
  @IsOptional() @IsString() onPrOpened?: string | null;
  @IsOptional() @IsString() onPrMerged?: string | null;
  @IsOptional() @IsBoolean() closeOnKeywords?: boolean;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

/** PATCH body: every field optional; fields that don't apply to the provider are ignored. */
class UpdateIntegrationDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true }) webhookUrl?: string | null;
  @IsOptional() @IsString() projectId?: string | null;
  @IsOptional() @IsArray() @IsIn(SLACK_EVENTS, { each: true }) events?: string[];
  @IsOptional() @IsString() commandProjectId?: string | null;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(200) signingSecret?: string;
  @IsOptional() @Matches(/^[\w.-]+\/[\w.-]+$/, { message: 'repository must look like owner/name' }) repository?: string | null;
  @IsOptional() @IsBoolean() createTasksFromIssues?: boolean;
  @IsOptional() @IsString() onPrOpened?: string | null;
  @IsOptional() @IsString() onPrMerged?: string | null;
  @IsOptional() @IsBoolean() closeOnKeywords?: boolean;
}

const DEFAULT_SLACK_EVENTS = ['TASK_CREATED', 'TASK_UPDATED', 'COMMENT_CREATED', 'SPRINT_STARTED', 'SPRINT_COMPLETED', 'DEV_LINKED'];

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly slack: SlackService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private toDto(i: Integration, secret?: string | null) {
    const hookPath = i.provider === 'slack' ? `/api/v1/hooks/slack/${i.id}/commands` : `/api/v1/hooks/github/${i.id}`;
    const { webhookUrl, ...config } = i.config ?? {};
    return {
      id: i.id,
      provider: i.provider,
      name: i.name,
      enabled: i.enabled,
      // Slack webhook URLs are credentials: only show enough to recognise them.
      config: i.provider === 'slack' ? { ...config, webhookUrl: webhookUrl ? `${String(webhookUrl).slice(0, 34)}…` : null, hasWebhook: !!webhookUrl } : i.config,
      hookPath,
      lastStatus: i.lastStatus,
      lastError: i.lastError,
      lastActivityAt: i.lastActivityAt,
      createdAt: i.createdAt,
      ...(secret ? { secret } : {}),
    };
  }

  async list(orgId: string) {
    const rows = await this.dataSource.getRepository(Integration).createQueryBuilder('i').addSelect('i.secret').where('i.organization_id = :orgId', { orgId }).orderBy('i.created_at').getMany();
    return rows.map((i) => ({ ...this.toDto(i), slashCommandEnabled: i.provider === 'slack' ? !!i.secret : undefined }));
  }

  async createSlack(u: AuthPrincipal, dto: SlackIntegrationDto) {
    this.assertSlackUrl(dto.webhookUrl);
    const config: SlackConfig = {
      webhookUrl: dto.webhookUrl ?? null,
      projectId: await this.projectId(u.organizationId, dto.projectId),
      events: dto.events ?? DEFAULT_SLACK_EVENTS,
      commandProjectId: await this.projectId(u.organizationId, dto.commandProjectId),
    };
    const repo = this.dataSource.getRepository(Integration);
    const saved = await repo.save(repo.create({ organizationId: u.organizationId, provider: 'slack', name: dto.name.trim(), config, secret: dto.signingSecret ?? null, enabled: dto.enabled ?? true, createdById: u.userId }));
    return this.toDto(saved);
  }

  async createGithub(u: AuthPrincipal, dto: GithubIntegrationDto) {
    const config: GithubConfig = {
      repository: dto.repository ?? null,
      projectId: await this.projectId(u.organizationId, dto.projectId),
      createTasksFromIssues: dto.createTasksFromIssues ?? false,
      onPrOpened: dto.onPrOpened === undefined ? TaskStatus.IN_REVIEW : dto.onPrOpened,
      onPrMerged: dto.onPrMerged === undefined ? TaskStatus.DONE : dto.onPrMerged,
      closeOnKeywords: dto.closeOnKeywords ?? true,
    };
    if (config.createTasksFromIssues && !config.projectId) throw ApiException.badRequest('PROJECT_REQUIRED', 'Choose a project for tasks created from issues');
    const secret = randomBytes(24).toString('hex');
    const repo = this.dataSource.getRepository(Integration);
    const saved = await repo.save(repo.create({ organizationId: u.organizationId, provider: 'github', name: dto.name.trim(), config, secret, enabled: dto.enabled ?? true, createdById: u.userId }));
    // The webhook secret is shown once: paste it into GitHub → Settings → Webhooks.
    return this.toDto(saved, secret);
  }

  async update(u: AuthPrincipal, id: string, dto: UpdateIntegrationDto) {
    const repo = this.dataSource.getRepository(Integration);
    const i = await repo.findOneBy({ id, organizationId: u.organizationId });
    if (!i) throw ApiException.notFound('integration');
    if (dto.name) i.name = dto.name.trim();
    if (dto.enabled !== undefined) i.enabled = dto.enabled;
    const c = { ...i.config };
    if (i.provider === 'slack') {
      if (dto.webhookUrl !== undefined) {
        this.assertSlackUrl(dto.webhookUrl);
        c.webhookUrl = dto.webhookUrl;
      }
      if (dto.events) c.events = dto.events;
      if (dto.projectId !== undefined) c.projectId = await this.projectId(u.organizationId, dto.projectId);
      if (dto.commandProjectId !== undefined) c.commandProjectId = await this.projectId(u.organizationId, dto.commandProjectId);
      if (dto.signingSecret) await repo.update({ id }, { secret: dto.signingSecret });
    } else {
      for (const k of ['repository', 'createTasksFromIssues', 'onPrOpened', 'onPrMerged', 'closeOnKeywords'] as const) if (dto[k] !== undefined) c[k] = dto[k];
      if (dto.projectId !== undefined) c.projectId = await this.projectId(u.organizationId, dto.projectId);
    }
    i.config = c;
    return this.toDto(await repo.save(i));
  }

  async remove(u: AuthPrincipal, id: string) {
    const result = await this.dataSource.getRepository(Integration).delete({ id, organizationId: u.organizationId });
    if (!result.affected) throw ApiException.notFound('integration');
    return { id, deleted: true };
  }

  async test(u: AuthPrincipal, id: string) {
    const i = await this.dataSource.getRepository(Integration).findOneBy({ id, organizationId: u.organizationId });
    if (!i) throw ApiException.notFound('integration');
    if (i.provider !== 'slack' || !(i.config as SlackConfig).webhookUrl) throw ApiException.badRequest('NOT_TESTABLE', 'Only Slack integrations with a webhook URL can send a test message');
    await this.slack.sendTest(i);
    return { queued: true };
  }

  async withSecret(id: string, provider: 'slack' | 'github') {
    return this.dataSource.getRepository(Integration).createQueryBuilder('i').addSelect('i.secret').where('i.id = :id AND i.provider = :provider AND i.enabled', { id, provider }).getOne();
  }

  private async projectId(orgId: string, idOrKey?: string | null) {
    if (!idOrKey) return null;
    return (await findProject(this.dataSource.manager, orgId, idOrKey)).id;
  }

  private assertSlackUrl(url?: string | null) {
    if (!url || this.config.webhookAllowPrivate) return;
    if (new URL(url).hostname !== 'hooks.slack.com' || !url.startsWith('https://')) throw ApiException.badRequest('INVALID_SLACK_URL', 'Use a Slack Incoming Webhook URL (https://hooks.slack.com/…)');
  }
}

@ApiTags('integrations')
@ApiBearerAuth()
@MinRole(Role.ADMIN)
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  list(@CurrentUser() u: AuthPrincipal) {
    return this.integrations.list(u.organizationId);
  }

  @Post('slack')
  slack(@CurrentUser() u: AuthPrincipal, @Body() dto: SlackIntegrationDto) {
    return this.integrations.createSlack(u, dto);
  }

  @Post('github')
  github(@CurrentUser() u: AuthPrincipal, @Body() dto: GithubIntegrationDto) {
    return this.integrations.createGithub(u, dto);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateIntegrationDto) {
    return this.integrations.update(u, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.remove(u, id);
  }

  @Post(':id/test')
  test(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.test(u, id);
  }
}

/** Inbound endpoints called by Slack and GitHub; authenticated by request signatures, not JWTs. */
@ApiTags('integrations')
@Public()
@Controller('hooks')
export class HooksController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly slack: SlackService,
    private readonly github: GithubService,
  ) {}

  @Post('slack/:id/commands')
  @HttpCode(200)
  async slackCommand(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const i = await this.integrations.withSecret(id, 'slack');
    if (!i?.secret) throw ApiException.notFound('integration');
    this.slack.verify(i.secret, req.header('x-slack-request-timestamp'), req.header('x-slack-signature'), raw);
    // Slack expects its own message shape, not the API envelope.
    return new RawJson(await this.slack.command(i, new URLSearchParams(raw)));
  }

  @Post('github/:id')
  @HttpCode(202)
  async githubWebhook(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const i = await this.integrations.withSecret(id, 'github');
    if (!i?.secret) throw ApiException.notFound('integration');
    this.github.verify(i.secret, req.header('x-hub-signature-256'), raw);
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString('utf8') || '{}');
    } catch {
      throw ApiException.badRequest('INVALID_PAYLOAD', 'Body must be JSON (set the GitHub webhook content type to application/json)');
    }
    return this.github.handle(i, req.header('x-github-event') ?? 'unknown', payload);
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: WEBHOOK_QUEUE }, { name: INTEGRATIONS_QUEUE }), TasksModule],
  controllers: [WebhooksController, IntegrationsController, HooksController],
  providers: [WebhooksService, WebhookDeliveryProcessor, IntegrationsService, SlackService, GithubService, IntegrationsProcessor],
})
export class IntegrationsModule {}
