import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Logger, Module, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { CurrentUser, MinRole, Public } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { TokenService } from '../../common/auth/token.service';
import { SecretBox } from '../../common/crypto/secret-box';
import { EventBus } from '../../common/events/event-bus.service';
import { ApiException } from '../../common/http/api-exception';
import { APP_CONFIG, AppConfig } from '../../config';
import { Membership } from '../organizations/membership.entity';
import { User } from '../users/user.entity';
import { assertIssuerUrl, discover, exchangeCode, OidcError, pkceChallenge, randomToken, verifyIdToken } from './oidc';
import { SsoConnection, toConnectionDto, UserIdentity } from './sso.entity';

const COOKIE = 'workora_sso';
const STATE_TTL_MS = 10 * 60_000;
const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/;

class ConnectionDto {
  @IsString() @MinLength(1) @MaxLength(40) providerName: string;
  @IsString() @MaxLength(300) issuer: string;
  @IsString() @MinLength(1) @MaxLength(300) clientId: string;
  /** Required when creating; omit to keep the stored secret. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(500) clientSecret?: string;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @Matches(DOMAIN_RE, { each: true, message: 'domains must look like example.com' }) domains: string[];
  @IsOptional() @IsBoolean() autoProvision?: boolean;
  @IsOptional() @IsEnum([Role.ADMIN, Role.MEMBER, Role.VIEWER]) defaultRole?: Role;
  @IsOptional() @IsBoolean() enforce?: boolean;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

interface SsoState {
  c: string; // connection id
  n: string; // nonce
  v: string; // PKCE verifier
  b: string; // hash of the browser-binding cookie
  e: number; // expiry (ms)
}

const domainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? '';
const sha = (s: string) => createHash('sha256').update(s).digest('base64url');

function cookieValue(req: Request, name: string) {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/**
 * OpenID Connect single sign-on (authorization code + PKCE). Works with Okta, Microsoft Entra ID,
 * Google Workspace, Auth0, Keycloak, OneLogin… anything that publishes `.well-known/openid-configuration`.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly box: SecretBox,
    private readonly tokens: TokenService,
    private readonly events: EventBus,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get redirectUri() {
    return `${this.config.apiPublicUrl}/auth/sso/callback`;
  }

  private repo() {
    return this.dataSource.getRepository(SsoConnection);
  }

  async get(orgId: string) {
    const c = await this.repo().findOneBy({ organizationId: orgId });
    return { connection: c ? toConnectionDto(c) : null, redirectUri: this.redirectUri };
  }

  async save(u: AuthPrincipal, dto: ConnectionDto) {
    const issuer = this.issuer(dto.issuer);
    const domains = [...new Set(dto.domains.map((d) => d.trim().toLowerCase()))];
    // A domain can route to one workspace only, otherwise "which provider?" is ambiguous at sign-in.
    for (const d of domains) {
      const clash = await this.repo().createQueryBuilder('c').where('c.organization_id <> :org AND c.domains ? :d', { org: u.organizationId, d }).getOne();
      if (clash) throw ApiException.conflict('DOMAIN_TAKEN', `${d} already signs in through another workspace`);
    }
    if (dto.enforce && !domains.length) throw ApiException.badRequest('DOMAINS_REQUIRED', 'Add at least one email domain before enforcing SSO');
    const existing = await this.repo().findOne({ where: { organizationId: u.organizationId }, select: { id: true, clientSecret: true } as never });
    if (!existing && !dto.clientSecret) throw ApiException.badRequest('CLIENT_SECRET_REQUIRED', 'Client secret is required');
    const row = {
      organizationId: u.organizationId,
      providerName: dto.providerName.trim(),
      issuer,
      clientId: dto.clientId.trim(),
      domains,
      autoProvision: dto.autoProvision ?? true,
      defaultRole: dto.defaultRole ?? Role.MEMBER,
      enforce: dto.enforce ?? false,
      enabled: dto.enabled ?? true,
      ...(dto.clientSecret ? { clientSecret: this.box.seal(dto.clientSecret) } : {}),
    };
    if (existing) await this.repo().update({ id: existing.id }, row);
    else await this.repo().insert(row as SsoConnection);
    return this.get(u.organizationId);
  }

  async remove(u: AuthPrincipal) {
    await this.repo().delete({ organizationId: u.organizationId });
    return { deleted: true };
  }

  /** Fetches discovery + signing keys so admins find typos before users do. */
  async test(u: AuthPrincipal) {
    const c = await this.repo().findOneBy({ organizationId: u.organizationId });
    if (!c) throw ApiException.notFound('sso connection');
    try {
      const d = await discover(c.issuer, true);
      const keys = (await fetch(d.jwks_uri, { signal: AbortSignal.timeout(8000) }).then((r) => r.json())) as { keys?: unknown[] };
      await this.repo().update({ id: c.id }, { lastError: null });
      return { ok: true, authorizationEndpoint: d.authorization_endpoint, keys: Array.isArray(keys?.keys) ? keys.keys.length : 0 };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await this.repo().update({ id: c.id }, { lastError: message.slice(0, 250) });
      throw new ApiException(502, 'SSO_TEST_FAILED', message);
    }
  }

  /** Login page helper: does this email belong to an SSO domain? */
  async discoverFor(email: string) {
    const c = await this.forEmail(email);
    return c ? { sso: true, providerName: c.providerName, enforced: c.enforce, startUrl: `${this.config.apiPublicUrl}/auth/sso/start?email=${encodeURIComponent(email.trim().toLowerCase())}` } : { sso: false };
  }

  private forEmail(email: string) {
    const d = domainOf(String(email ?? '').trim());
    if (!DOMAIN_RE.test(d)) return Promise.resolve(null);
    return this.repo().createQueryBuilder('c').where('c.enabled AND c.domains ? :d', { d }).getOne();
  }

  /** Builds the authorization redirect. The browser gets a binding cookie; the state is sealed. */
  async start(email: string) {
    const c = await this.forEmail(email);
    if (!c) throw ApiException.badRequest('SSO_NOT_CONFIGURED', 'No single sign-on is set up for that email domain');
    const d = await discover(c.issuer);
    const binding = randomToken();
    const nonce = randomToken(16);
    const verifier = randomToken(48);
    const state: SsoState = { c: c.id, n: nonce, v: verifier, b: sha(binding), e: Date.now() + STATE_TTL_MS };
    const url = new URL(d.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: c.clientId,
      redirect_uri: this.redirectUri,
      scope: 'openid email profile',
      state: this.box.seal(JSON.stringify(state)),
      nonce,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: 'S256',
      login_hint: email.trim().toLowerCase(),
    }).toString();
    return { url: url.toString(), binding };
  }

  /** Completes sign-in: verifies everything, finds or provisions the user, returns a Workora session token. */
  async callback(query: { code?: string; state?: string; error?: string; error_description?: string }, binding: string | null) {
    if (query.error) throw new OidcError(query.error_description ?? query.error);
    if (!query.code || !query.state) throw new OidcError('Missing code or state');
    let state: SsoState;
    try {
      state = JSON.parse(this.box.open(query.state));
    } catch {
      throw new OidcError('Invalid sign-in state');
    }
    if (state.e < Date.now()) throw new OidcError('Sign-in took too long — please try again');
    // Must finish in the same browser that started (login CSRF protection).
    const bound = binding ? Buffer.from(sha(binding)) : null;
    if (!bound || bound.length !== Buffer.from(state.b).length || !timingSafeEqual(bound, Buffer.from(state.b))) throw new OidcError('Sign-in must finish in the browser that started it');

    const c = await this.repo().findOne({ where: { id: state.c }, select: { id: true, organizationId: true, providerName: true, issuer: true, clientId: true, clientSecret: true, domains: true, autoProvision: true, defaultRole: true, enabled: true } as never });
    if (!c || !c.enabled) throw new OidcError('Single sign-on is turned off for this workspace');
    try {
      const d = await discover(c.issuer);
      const idToken = await exchangeCode(d, { code: query.code, redirectUri: this.redirectUri, clientId: c.clientId, clientSecret: this.box.open(c.clientSecret), verifier: state.v });
      const claims = await verifyIdToken(idToken, d, c.clientId, state.n);
      const email = String(claims.email ?? '').trim().toLowerCase();
      if (!email) throw new OidcError('The provider did not share an email address (add the "email" scope)');
      if (claims.email_verified === false || claims.email_verified === 'false') throw new OidcError('Your email address is not verified with the provider');
      if (c.domains.length && !c.domains.includes(domainOf(email))) throw new OidcError(`${email} is not on an allowed domain for this workspace`);
      const userId = await this.provision(c, claims.sub, email, claims.name || claims.preferred_username || email.split('@')[0]);
      await this.repo().update({ id: c.id }, { lastLoginAt: new Date(), lastError: null });
      return this.tokens.issue(userId, c.organizationId, 'sso');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await this.repo().update({ id: c.id }, { lastError: message.slice(0, 250) });
      throw e;
    }
  }

  private async provision(c: SsoConnection, subject: string, email: string, name: string) {
    const { userId, joined } = await this.dataSource.transaction(async (m) => {
      const identity = await m.findOneBy(UserIdentity, { connectionId: c.id, subject });
      let user = identity ? await m.findOneBy(User, { id: identity.userId }) : await m.findOneBy(User, { email });
      if (!user) {
        if (!c.autoProvision) throw new OidcError(`${email} hasn't been invited to this workspace yet`);
        // No usable password: the account signs in through SSO (an admin can still reset it later).
        user = await m.save(m.create(User, { email, name: name.slice(0, 120), passwordHash: `!sso:${randomBytes(16).toString('hex')}` }));
      }
      if (identity) await m.update(UserIdentity, { id: identity.id }, { lastLoginAt: new Date(), email });
      else await m.insert(UserIdentity, { userId: user.id, connectionId: c.id, subject, email, lastLoginAt: new Date() });
      let joined: Membership | null = null;
      if (!(await m.existsBy(Membership, { organizationId: c.organizationId, userId: user.id }))) {
        if (!c.autoProvision) throw new OidcError(`${email} isn't a member of this workspace`);
        joined = await m.save(m.create(Membership, { organizationId: c.organizationId, userId: user.id, role: c.defaultRole }));
      }
      return { userId: user.id, joined: joined ? { user, role: joined.role } : null };
    });
    if (joined) {
      this.events.publish('USER_ADDED', {
        organizationId: c.organizationId,
        actor: { id: userId, name: `${joined.user.name} via ${c.providerName}` },
        data: { user: { id: joined.user.id, name: joined.user.name, email: joined.user.email }, role: joined.role },
      });
    }
    return userId;
  }

  private issuer(raw: string) {
    try {
      return assertIssuerUrl(raw.trim(), this.config.webhookAllowPrivate);
    } catch (e) {
      throw ApiException.badRequest('INVALID_ISSUER', e instanceof Error ? e.message : 'Invalid issuer');
    }
  }

  errorRedirect(message: string) {
    return `${this.config.appUrl}/login?sso_error=${encodeURIComponent(message)}`;
  }

  successRedirect(token: string) {
    // Fragment, not query: tokens never reach server logs or Referer headers.
    return `${this.config.appUrl}/sso/callback#token=${encodeURIComponent(token)}`;
  }

  cookieOptions() {
    return { httpOnly: true, sameSite: 'lax' as const, secure: this.config.apiPublicUrl.startsWith('https:'), path: '/api/v1/auth/sso', maxAge: STATE_TTL_MS };
  }

  logFailure(e: unknown) {
    this.logger.warn(`SSO sign-in failed: ${e instanceof Error ? e.message : e}`);
  }
}

@ApiTags('sso')
@ApiBearerAuth()
@MinRole(Role.ADMIN)
@Controller('sso')
export class SsoAdminController {
  constructor(private readonly sso: SsoService) {}

  @Get()
  get(@CurrentUser() u: AuthPrincipal) {
    return this.sso.get(u.organizationId);
  }

  @Put()
  save(@CurrentUser() u: AuthPrincipal, @Body() dto: ConnectionDto) {
    return this.sso.save(u, dto);
  }

  @Delete()
  remove(@CurrentUser() u: AuthPrincipal) {
    return this.sso.remove(u);
  }

  @Post('test')
  @HttpCode(200)
  test(@CurrentUser() u: AuthPrincipal) {
    return this.sso.test(u);
  }
}

@ApiTags('sso')
@Public()
@Controller('auth/sso')
export class SsoAuthController {
  constructor(private readonly sso: SsoService) {}

  @Get('discover')
  discover(@Query('email') email = '') {
    return this.sso.discoverFor(email);
  }

  /** Browser navigation target: sets the binding cookie and redirects to the identity provider. */
  @Get('start')
  async start(@Query('email') email = '', @Res() res: Response) {
    try {
      const { url, binding } = await this.sso.start(email);
      res.cookie(COOKIE, binding, this.sso.cookieOptions());
      res.redirect(302, url);
    } catch (e) {
      this.sso.logFailure(e);
      res.redirect(302, this.sso.errorRedirect(e instanceof Error ? e.message : 'Could not start single sign-on'));
    }
  }

  @Get('callback')
  async callback(@Query() query: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    try {
      const token = await this.sso.callback(query, cookieValue(req, COOKIE));
      res.clearCookie(COOKIE, { path: '/api/v1/auth/sso' });
      res.redirect(302, this.sso.successRedirect(token));
    } catch (e) {
      this.sso.logFailure(e);
      res.clearCookie(COOKIE, { path: '/api/v1/auth/sso' });
      res.redirect(302, this.sso.errorRedirect(e instanceof Error ? e.message : 'Single sign-on failed'));
    }
  }
}

@Module({ controllers: [SsoAdminController, SsoAuthController], providers: [SsoService] })
export class SsoModule {}
