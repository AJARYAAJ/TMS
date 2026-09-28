import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Body, Controller, Delete, Get, Inject, Injectable, Logger, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Job, Queue } from 'bullmq';
import { IsArray, IsBoolean, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { createHmac, randomBytes, randomUUID } from 'crypto';
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

@Module({
  imports: [BullModule.registerQueue({ name: WEBHOOK_QUEUE })],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDeliveryProcessor],
})
export class IntegrationsModule {}
