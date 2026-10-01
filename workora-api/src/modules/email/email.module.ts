import { Body, Controller, Get, HttpCode, Inject, Injectable, Logger, Module, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UnrecoverableError } from 'bullmq';
import { IsBoolean, IsObject, IsOptional } from 'class-validator';
import { createTransport, Transporter } from 'nodemailer';
import { DataSource } from 'typeorm';
import { CurrentUser, MinRole, Public } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { ApiException } from '../../common/http/api-exception';
import { APP_CONFIG, AppConfig } from '../../config';
import { Organization } from '../organizations/organization.entity';
import { User } from '../users/user.entity';
import { DeliveryStatus, EmailDelivery, toDeliveryDto } from './email-delivery.entity';
import { EMAIL_CATEGORIES, EmailCategory, effectivePrefs, isEmailCategory, UnsubscribeTokens, wantsEmail } from './email-prefs';
import { renderNotificationEmail } from './email-templates';

/** Queued by NotificationListener, delivered by JobsProcessor via EmailService.deliver. */
export interface NotificationEmailJob {
  organizationId: string;
  userId: string;
  category: EmailCategory;
  subject: string;
  heading: string;
  body?: string;
  actorName?: string | null;
  orgName: string;
  task?: { key: string; title: string } | null;
  url: string;
}

const maskEmail = (email: string) => {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(local.length - 1, 6)))}@${domain}`;
};

/**
 * Email transport. With SMTP configured (SMTP_URL or SMTP_HOST…) mail goes out through a pooled
 * nodemailer SMTP transport; without it messages are fully rendered but only logged.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transport: Transporter;
  readonly mode: 'smtp' | 'log';
  readonly tokens: UnsubscribeTokens;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly dataSource: DataSource,
  ) {
    const s = config.smtp;
    this.mode = s.host ? 'smtp' : 'log';
    this.transport = s.host
      ? createTransport({
          host: s.host,
          port: s.port,
          secure: s.secure,
          requireTLS: s.requireTls,
          auth: s.user ? { user: s.user, pass: s.pass ?? '' } : undefined,
          tls: { rejectUnauthorized: s.rejectUnauthorized },
          pool: true,
          maxConnections: 3,
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
        })
      : createTransport({ jsonTransport: true });
    this.tokens = new UnsubscribeTokens(config.jwtSecret);
  }

  status() {
    const s = this.config.smtp;
    return { transport: this.mode, host: s.host, port: s.host ? s.port : null, secure: s.secure, requireTls: s.requireTls, authenticated: !!s.user, from: s.from };
  }

  /** Sends one message; throws the transport error on failure. Returns the Message-ID. */
  async send(msg: { to: string; subject: string; html: string; text: string; headers?: Record<string, string> }): Promise<string> {
    const info = await this.transport.sendMail({ from: this.config.smtp.from, ...msg });
    if (this.mode === 'log') this.logger.log(`✉  (SMTP not configured, not sent) to=${msg.to} subject="${msg.subject}"`);
    return info.messageId;
  }

  links(userId: string, category: EmailCategory) {
    const token = this.tokens.sign(userId, category);
    return {
      page: `${this.config.appUrl}/unsubscribe?token=${encodeURIComponent(token)}`,
      oneClick: `${this.config.apiPublicUrl}/email/unsubscribe?token=${encodeURIComponent(token)}`,
      preferences: `${this.config.appUrl}/settings`,
    };
  }

  /**
   * Delivers a queued notification email. Preferences are re-checked at send time, so an
   * unsubscribe takes effect for mail that is already queued. Permanent SMTP failures (5xx)
   * are not retried; transient ones are, and only the final outcome is logged.
   */
  async deliver(job: NotificationEmailJob, attempt: number, maxAttempts: number) {
    const user = await this.dataSource.getRepository(User).findOne({ where: { id: job.userId }, select: { id: true, email: true, emailPrefs: true } });
    if (!user || !wantsEmail(user.emailPrefs, job.category)) {
      if (user) await this.record(job, user.email, 'skipped', { error: 'Recipient turned this email off' });
      return { skipped: true };
    }
    const links = this.links(user.id, job.category);
    const { html, text } = renderNotificationEmail({
      orgName: job.orgName,
      heading: job.heading,
      body: job.body,
      actorName: job.actorName,
      task: job.task,
      cta: { label: job.task ? `Open ${job.task.key}` : 'Open Workora', url: job.url },
      reason: EMAIL_CATEGORIES[job.category].reason,
      unsubscribeUrl: links.page,
      preferencesUrl: links.preferences,
    });
    try {
      const messageId = await this.send({
        to: user.email,
        subject: job.subject,
        html,
        text,
        headers: { 'List-Unsubscribe': `<${links.oneClick}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      await this.record(job, user.email, 'sent', { messageId, attempts: attempt });
      return { messageId };
    } catch (err: any) {
      // 5xx = permanent rejection (bad mailbox, policy); 4xx and network errors are worth retrying.
      const permanent = Number(err?.responseCode) >= 500;
      const message = String(err?.response ?? err?.message ?? err).slice(0, 500);
      if (permanent || attempt >= maxAttempts) await this.record(job, user.email, 'failed', { error: message, attempts: attempt });
      if (permanent) throw new UnrecoverableError(message);
      throw err;
    }
  }

  /** Sends a test email to the caller right away (not queued) so admins see SMTP errors immediately. */
  async sendTest(u: AuthPrincipal) {
    const org = await this.dataSource.getRepository(Organization).findOneByOrFail({ id: u.organizationId });
    const subject = 'Workora test email';
    const { html, text } = renderNotificationEmail({
      orgName: org.name,
      heading: 'Your email settings work',
      body: this.mode === 'smtp' ? `Sent through ${this.config.smtp.host}:${this.config.smtp.port} from ${this.config.smtp.from}.` : 'SMTP is not configured, so this message was only logged.',
      actorName: u.name,
      cta: { label: 'Open Workora', url: this.config.appUrl },
      reason: 'an admin sent a test email',
      preferencesUrl: `${this.config.appUrl}/settings`,
    });
    const base = { organizationId: u.organizationId, userId: u.userId, category: 'test', subject };
    try {
      const messageId = await this.send({ to: u.email, subject, html, text });
      await this.save({ ...base, recipient: u.email, status: 'sent', messageId });
      return { sent: this.mode === 'smtp', transport: this.mode, to: u.email, messageId };
    } catch (err: any) {
      const message = String(err?.response ?? err?.message ?? err).slice(0, 500);
      await this.save({ ...base, recipient: u.email, status: 'failed', error: message });
      throw new ApiException(502, 'EMAIL_FAILED', `SMTP error: ${message}`);
    }
  }

  private record(job: NotificationEmailJob, recipient: string, status: DeliveryStatus, extra: Partial<EmailDelivery> = {}) {
    return this.save({ organizationId: job.organizationId, userId: job.userId, recipient, category: job.category, subject: job.subject.slice(0, 250), status, ...extra });
  }

  private save(d: Partial<EmailDelivery>) {
    const repo = this.dataSource.getRepository(EmailDelivery);
    return repo.save(repo.create(d));
  }
}

class UpdateEmailPreferencesDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  /** `{ "comments": true, "status": false }` */
  @IsOptional() @IsObject() categories?: Record<string, boolean>;
}

const categoryOptions = () => (Object.keys(EMAIL_CATEGORIES) as EmailCategory[]).map((key) => ({ key, label: EMAIL_CATEGORIES[key].label, description: EMAIL_CATEGORIES[key].description, default: EMAIL_CATEGORIES[key].default }));

@ApiTags('email')
@ApiBearerAuth()
@Controller('email')
export class EmailController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly email: EmailService,
  ) {}

  private async prefsOf(userId: string) {
    const user = await this.dataSource.getRepository(User).findOneOrFail({ where: { id: userId }, select: { id: true, email: true, emailPrefs: true } });
    return user;
  }

  /** The caller's email preferences (defaults filled in) and the available categories. */
  @Get('preferences')
  async preferences(@CurrentUser() u: AuthPrincipal) {
    const user = await this.prefsOf(u.userId);
    return { email: user.email, ...effectivePrefs(user.emailPrefs), options: categoryOptions() };
  }

  @Patch('preferences')
  async updatePreferences(@CurrentUser() u: AuthPrincipal, @Body() dto: UpdateEmailPreferencesDto) {
    const patch: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(dto.categories ?? {})) {
      if (!isEmailCategory(k)) throw ApiException.badRequest('UNKNOWN_EMAIL_CATEGORY', `Unknown email category "${k}"`);
      if (typeof v !== 'boolean') throw ApiException.badRequest('VALIDATION_ERROR', `categories.${k} must be a boolean`);
      patch[k] = v;
    }
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    await this.dataSource.query(`UPDATE users SET email_prefs = email_prefs || $2::jsonb WHERE id = $1`, [u.userId, JSON.stringify(patch)]);
    return this.preferences(u);
  }

  /** What an unsubscribe link would do (for the confirmation page). GET never changes anything. */
  @Public()
  @Get('unsubscribe')
  async peekUnsubscribe(@Query('token') token: string) {
    const { user, category } = await this.resolveToken(token);
    const prefs = effectivePrefs(user.emailPrefs);
    return {
      email: maskEmail(user.email),
      category,
      label: category === 'all' ? 'All Workora email' : EMAIL_CATEGORIES[category].label,
      subscribed: category === 'all' ? prefs.enabled : prefs.enabled && prefs.categories[category],
    };
  }

  /** Unsubscribes. Also the RFC 8058 one-click target of the List-Unsubscribe header. */
  @Public()
  @Post('unsubscribe')
  @HttpCode(200)
  async unsubscribe(@Query('token') token: string) {
    const { user, category } = await this.resolveToken(token);
    await this.dataSource.query(`UPDATE users SET email_prefs = email_prefs || $2::jsonb WHERE id = $1`, [user.id, JSON.stringify({ [category === 'all' ? 'enabled' : category]: false })]);
    return { unsubscribed: true, category, label: category === 'all' ? 'All Workora email' : EMAIL_CATEGORIES[category].label };
  }

  /** Transport settings (never the password) and this organization's recent deliveries. */
  @MinRole(Role.ADMIN)
  @Get('status')
  async status(@CurrentUser() u: AuthPrincipal) {
    const deliveries = await this.dataSource.getRepository(EmailDelivery).find({ where: { organizationId: u.organizationId }, order: { createdAt: 'DESC' }, take: 25 });
    const counts: { status: string; count: string }[] = await this.dataSource.query(
      `SELECT status, count(*) FROM email_deliveries WHERE organization_id = $1 AND created_at > now() - interval '7 days' GROUP BY status`,
      [u.organizationId],
    );
    const last7Days = { sent: 0, failed: 0, skipped: 0 };
    for (const c of counts) last7Days[c.status as keyof typeof last7Days] = Number(c.count);
    return { ...this.email.status(), last7Days, deliveries: deliveries.map(toDeliveryDto) };
  }

  @MinRole(Role.ADMIN)
  @Post('test')
  @HttpCode(200)
  test(@CurrentUser() u: AuthPrincipal) {
    return this.email.sendTest(u);
  }

  private async resolveToken(token: string) {
    const parsed = this.email.tokens.verify(token);
    const user = parsed && (await this.dataSource.getRepository(User).findOne({ where: { id: parsed.userId }, select: { id: true, email: true, emailPrefs: true } }));
    if (!parsed || !user) throw ApiException.badRequest('INVALID_TOKEN', 'This unsubscribe link is invalid');
    return { user, category: parsed.category };
  }
}

@Module({
  controllers: [EmailController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
