process.env.DATABASE_URL ??= 'postgres://workora:workora@localhost:5432/workora_test';
process.env.QUEUE_PREFIX = 'workora-test-sec';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.APP_URL = 'https://app.workora.test/workora';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { loadConfig } from '../src/config';
import { base32Encode, currentStep, hotp, verifyTotp } from '../src/common/auth/totp';
import { SecretBox } from '../src/common/crypto/secret-box';
import { startMockIdp } from './support/mock-oidc';

jest.setTimeout(60_000);

describe('TOTP & secret box (unit)', () => {
  it('matches the RFC 6238 test vector and rejects replays and stale codes', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(hotp(secret, 1)).toBe('287082'); // T = 59 s
    const now = 1_111_111_109_000; // RFC vector: 07081804
    expect(hotp(secret, currentStep(now))).toBe('081804');
    expect(verifyTotp(secret, '081804', null, now)).toBe(currentStep(now));
    expect(verifyTotp(secret, '081804', currentStep(now), now)).toBeNull(); // replay
    expect(verifyTotp(secret, hotp(secret, currentStep(now) - 3), null, now)).toBeNull(); // too old
    expect(verifyTotp(secret, 'abcdef', null, now)).toBeNull();
  });

  it('seals and opens secrets; tampering or another key fails', () => {
    const box = new SecretBox('k1');
    const sealed = box.seal('JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.open(sealed)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => new SecretBox('k2').open(sealed)).toThrow();
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => box.open(parts.join('.'))).toThrow();
  });
});

describe('Two-factor authentication & SSO (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  let owner: string;
  let idp: Awaited<ReturnType<typeof startMockIdp>>;
  const CLIENT = { clientId: 'workora-test', clientSecret: 'shh-secret' };

  beforeAll(async () => {
    const pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    await pg.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await pg.end();
    idp = await startMockIdp(CLIENT);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    await configureApp(app, { ...loadConfig(), realtimeRedisAdapter: false });
    await app.init();
    owner = (await http().post('/api/v1/auth/register').send({ name: 'Olga Owner', email: 'olga@acme.test', password: 'password123', organizationName: 'Acme' }).expect(201)).body.data.token;
    await http().post('/api/v1/organizations/current/members').set(auth(owner)).send({ email: 'mia@acme.test', name: 'Mia Member', role: 'MEMBER', password: 'password123' }).expect(201);
    await http().post('/api/v1/projects').set(auth(owner)).send({ name: 'Core', key: 'CORE' }).expect(201);
  });

  afterAll(async () => {
    jest.useRealTimers();
    await app?.close();
    await idp?.close();
  });

  const login = (email: string, password = 'password123') => http().post('/api/v1/auth/login').send({ email, password });

  describe('two-factor', () => {
    let secret: string;
    let recovery: string[];
    // Only Date is faked, so the TOTP time step is under test control while I/O timers run normally.
    let now = 0;
    const at = (ms: number) => {
      now = ms;
      jest.setSystemTime(ms);
    };
    const code = (offset = 0) => hotp(secret, currentStep(now) + offset);

    beforeAll(() => {
      jest.useFakeTimers({ doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'] });
      at(Math.floor(Date.now() / 30_000) * 30_000 + 15_000);
    });
    afterAll(() => jest.useRealTimers());

    it('sets up with a QR code and turns on after a valid code, returning recovery codes once', async () => {
      const s = (await http().post('/api/v1/auth/2fa/setup').set(auth(owner)).expect(200)).body.data;
      expect(s.qrSvg).toMatch(/^<svg/);
      expect(s.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Workora%3Aolga%40acme\.test\?secret=[A-Z2-7]+/);
      secret = s.secret;
      await http().post('/api/v1/auth/2fa/enable').set(auth(owner)).send({ code: '000000' }).expect(400);
      const on = (await http().post('/api/v1/auth/2fa/enable').set(auth(owner)).send({ code: code() }).expect(200)).body.data;
      expect(on.recoveryCodes).toHaveLength(10);
      expect(on.recoveryCodes[0]).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
      recovery = on.recoveryCodes;
      expect((await http().get('/api/v1/auth/2fa').set(auth(owner)).expect(200)).body.data).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
      await http().post('/api/v1/auth/2fa/setup').set(auth(owner)).expect(409);
    });

    it('stores the seed encrypted', async () => {
      const pg = new Client({ connectionString: process.env.DATABASE_URL });
      await pg.connect();
      const { rows } = await pg.query(`SELECT totp_secret, recovery_codes FROM users WHERE email = 'olga@acme.test'`);
      await pg.end();
      expect(rows[0].totp_secret.startsWith('v1.')).toBe(true);
      expect(rows[0].totp_secret).not.toContain(secret);
      expect(JSON.stringify(rows[0].recovery_codes)).not.toContain(recovery[0]);
    });

    it('password sign-in now needs a second step; the challenge token is not a session', async () => {
      const first = (await login('olga@acme.test').expect(200)).body.data;
      expect(first).toEqual({ mfaRequired: true, mfaToken: expect.any(String), methods: ['totp', 'recovery'] });
      expect(first.token).toBeUndefined();
      await http().get('/api/v1/auth/me').set(auth(first.mfaToken)).expect(401);
      await http().post('/api/v1/auth/login/2fa').send({ mfaToken: first.mfaToken, code: '123456' }).expect(401);
      at(now + 30_000);
      const session = (await http().post('/api/v1/auth/login/2fa').send({ mfaToken: first.mfaToken, code: code() }).expect(200)).body.data;
      expect(session.token).toBeTruthy();
      expect(session.security).toMatchObject({ signedInWith: 'mfa', twoFactorEnabled: true });
      owner = session.token;
      // The same code can't be used twice.
      const again = (await login('olga@acme.test').expect(200)).body.data;
      await http().post('/api/v1/auth/login/2fa').send({ mfaToken: again.mfaToken, code: code() }).expect(401);
    });

    it('recovery codes work exactly once', async () => {
      const c = (await login('olga@acme.test').expect(200)).body.data;
      await http().post('/api/v1/auth/login/2fa').send({ mfaToken: c.mfaToken, code: recovery[0].toUpperCase() }).expect(200);
      const c2 = (await login('olga@acme.test').expect(200)).body.data;
      await http().post('/api/v1/auth/login/2fa').send({ mfaToken: c2.mfaToken, code: recovery[0] }).expect(401);
      expect((await http().get('/api/v1/auth/2fa').set(auth(owner)).expect(200)).body.data.recoveryCodesLeft).toBe(9);
    });

    it('challenge tokens expire after 5 minutes', async () => {
      const c = (await login('olga@acme.test').expect(200)).body.data;
      at(now + 6 * 60_000);
      const res = await http().post('/api/v1/auth/login/2fa').send({ mfaToken: c.mfaToken, code: code() }).expect(401);
      expect(res.body.error.code).toBe('MFA_EXPIRED');
    });

    it('regenerates recovery codes with a fresh TOTP code', async () => {
      at(now + 30_000);
      const r = (await http().post('/api/v1/auth/2fa/recovery-codes').set(auth(owner)).send({ code: code() }).expect(200)).body.data;
      expect(r.recoveryCodes).toHaveLength(10);
      recovery = r.recoveryCodes;
      await http().post('/api/v1/auth/2fa/recovery-codes').set(auth(owner)).send({ code: recovery[0] }).expect(400); // TOTP only
    });

    it('workspace policy: admins need 2FA themselves; members are gated until they set it up', async () => {
      const member = (await login('mia@acme.test').expect(200)).body.data.token;
      await http().patch('/api/v1/organizations/current/security').set(auth(member)).send({ require2fa: true }).expect(403);
      const res = (await http().patch('/api/v1/organizations/current/security').set(auth(owner)).send({ require2fa: true }).expect(200)).body.data;
      expect(res).toEqual({ require2fa: true, membersWithout2fa: 1 });
      const gated = await http().get('/api/v1/projects').set(auth(member)).expect(403);
      expect(gated.body.error.code).toBe('MFA_SETUP_REQUIRED');
      expect((await http().get('/api/v1/auth/me').set(auth(member)).expect(200)).body.data.security).toMatchObject({ mfaSetupRequired: true, workspaceRequiresTwoFactor: true });
      const s = (await http().post('/api/v1/auth/2fa/setup').set(auth(member)).expect(200)).body.data;
      await http().post('/api/v1/auth/2fa/enable').set(auth(member)).send({ code: hotp(s.secret, currentStep(now)) }).expect(200);
      await http().get('/api/v1/projects').set(auth(member)).expect(200);
      // Can't switch it off while the workspace requires it.
      await http().post('/api/v1/auth/2fa/disable').set(auth(member)).send({ password: 'password123', code: hotp(s.secret, currentStep(now) + 1) }).expect(403);
      const members = (await http().get('/api/v1/organizations/current/members').set(auth(owner)).expect(200)).body.data;
      expect(members.every((m: any) => m.twoFactorEnabled)).toBe(true);
    });

    it('turning 2FA off needs the password and a code', async () => {
      await http().patch('/api/v1/organizations/current/security').set(auth(owner)).send({ require2fa: false }).expect(200);
      await http().post('/api/v1/auth/2fa/disable').set(auth(owner)).send({ password: 'wrong', code: recovery[1] }).expect(401);
      await http().post('/api/v1/auth/2fa/disable').set(auth(owner)).send({ password: 'password123', code: recovery[1] }).expect(200);
      const plain = (await login('olga@acme.test').expect(200)).body.data;
      expect(plain.token).toBeTruthy();
      owner = plain.token;
    });
  });

  describe('single sign-on (OIDC)', () => {
    /** Runs the browser part: start → identity provider → callback, carrying the binding cookie. */
    const ssoFlow = async (email: string, opts: { dropCookie?: boolean } = {}) => {
      const start = await http().get(`/api/v1/auth/sso/start?email=${encodeURIComponent(email)}`).expect(302);
      const location = new URL(start.headers.location);
      if (!location.href.startsWith(idp.issuer)) return { error: decodeURIComponent(new URL(location).searchParams.get('sso_error') ?? '') };
      const cookie = (start.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('workora_sso='))!.split(';')[0];
      expect(location.searchParams.get('code_challenge_method')).toBe('S256');
      expect(location.searchParams.get('scope')).toBe('openid email profile');
      const idpRes = await fetch(location, { redirect: 'manual' });
      const back = new URL(idpRes.headers.get('location')!);
      const cb = await http()
        .get(`${back.pathname}${back.search}`)
        .set(opts.dropCookie ? {} : { Cookie: cookie })
        .expect(302);
      const dest = new URL(cb.headers.location);
      if (dest.hash.startsWith('#token=')) return { token: decodeURIComponent(dest.hash.slice(7)), dest };
      return { error: dest.searchParams.get('sso_error') ?? '', dest };
    };

    it('only admins configure SSO; the client secret is never returned', async () => {
      const mia = (await login('mia@acme.test').expect(200)).body.data;
      await http().put('/api/v1/sso').set(auth(mia.token ?? '')).send({}).expect(mia.token ? 403 : 401);
      await http().put('/api/v1/sso').set(auth(owner)).send({ providerName: 'Okta', issuer: 'ftp://bad', clientId: 'x', clientSecret: 'y', domains: ['acme.test'] }).expect(400);
      const saved = (await http()
        .put('/api/v1/sso')
        .set(auth(owner))
        .send({ providerName: 'Acme IdP', issuer: idp.issuer, ...CLIENT, domains: ['acme.test', 'acme-labs.test'], defaultRole: 'MEMBER' })
        .expect(200)).body.data;
      expect(saved.redirectUri).toBe('https://app.workora.test/api/v1/auth/sso/callback');
      expect(JSON.stringify(saved)).not.toContain(CLIENT.clientSecret);
      expect((await http().post('/api/v1/sso/test').set(auth(owner)).expect(200)).body.data).toMatchObject({ ok: true, keys: 1 });
      expect((await http().get('/api/v1/auth/sso/discover?email=Someone@ACME.test').expect(200)).body.data).toMatchObject({ sso: true, providerName: 'Acme IdP', enforced: false });
      expect((await http().get('/api/v1/auth/sso/discover?email=x@gmail.com').expect(200)).body.data).toEqual({ sso: false });
    });

    it('signs in a new user with PKCE + verified ID token, provisions membership, links the identity', async () => {
      idp.state.user = { sub: 'okta|sam', email: 'Sam@Acme.test', name: 'Sam SSO' };
      const r = await ssoFlow('sam@acme.test');
      expect(r.dest!.toString().startsWith('https://app.workora.test/workora/sso/callback#token=')).toBe(true);
      const me = (await http().get('/api/v1/auth/me').set(auth(r.token!)).expect(200)).body.data;
      expect(me).toMatchObject({ user: { email: 'sam@acme.test', name: 'Sam SSO' }, role: 'MEMBER', security: { signedInWith: 'sso' } });
      // Second sign-in reuses the same account.
      const again = await ssoFlow('sam@acme.test');
      expect((await http().get('/api/v1/auth/me').set(auth(again.token!)).expect(200)).body.data.user.id).toBe(me.user.id);
      const members = (await http().get('/api/v1/organizations/current/members').set(auth(owner)).expect(200)).body.data;
      expect(members.filter((m: any) => m.user.email === 'sam@acme.test')).toHaveLength(1);
    });

    it('links an existing account by email instead of duplicating it', async () => {
      idp.state.user = { sub: 'okta|mia', email: 'mia@acme.test', name: 'Mia' };
      const r = await ssoFlow('mia@acme.test');
      expect((await http().get('/api/v1/auth/me').set(auth(r.token!)).expect(200)).body.data.user.name).toBe('Mia Member');
    });

    it.each([
      ['aud', 'audience'],
      ['nonce', 'nonce'],
      ['signature', 'signature'],
      ['expired', 'expired'],
      ['issuer', 'issuer'],
    ] as const)('rejects an ID token with a bad %s', async (tamper, word) => {
      idp.state.user = { sub: 'okta|sam', email: 'sam@acme.test' };
      idp.state.tamper = tamper;
      const r = await ssoFlow('sam@acme.test');
      expect(r.token).toBeUndefined();
      expect((r.error ?? '').toLowerCase()).toContain(word);
    });

    it('refuses callbacks from another browser, other domains, unverified emails and unknown domains', async () => {
      idp.state.user = { sub: 'okta|sam', email: 'sam@acme.test' };
      expect((await ssoFlow('sam@acme.test', { dropCookie: true })).error).toContain('browser that started');
      idp.state.user = { sub: 'okta|eve', email: 'eve@evil.test' };
      expect((await ssoFlow('sam@acme.test')).error).toContain('not on an allowed domain');
      idp.state.user = { sub: 'okta|uv', email: 'uv@acme.test', email_verified: false };
      expect((await ssoFlow('uv@acme.test')).error).toContain('not verified');
      expect((await ssoFlow('who@unknown.test')).error).toContain('No single sign-on');
    });

    it('without auto-provisioning, uninvited people are turned away', async () => {
      await http().put('/api/v1/sso').set(auth(owner)).send({ providerName: 'Acme IdP', issuer: idp.issuer, clientId: CLIENT.clientId, domains: ['acme.test'], autoProvision: false }).expect(200);
      idp.state.user = { sub: 'okta|new', email: 'newbie@acme.test' };
      expect((await ssoFlow('newbie@acme.test')).error).toContain("hasn't been invited");
    });

    it('enforced SSO blocks password sign-in for members but keeps owners as break-glass', async () => {
      await http().put('/api/v1/sso').set(auth(owner)).send({ providerName: 'Acme IdP', issuer: idp.issuer, clientId: CLIENT.clientId, domains: ['acme.test'], enforce: true }).expect(200);
      const blocked = await login('mia@acme.test').expect(403);
      expect(blocked.body.error).toMatchObject({ code: 'SSO_REQUIRED', details: { providerName: 'Acme IdP' } });
      await login('olga@acme.test').expect(200);
      // SSO sessions are exempt from the workspace 2FA requirement (the IdP handles MFA).
      idp.state.user = { sub: 'okta|mia', email: 'mia@acme.test' };
      const r = await ssoFlow('mia@acme.test');
      await http().get('/api/v1/projects').set(auth(r.token!)).expect(200);
    });
  });
});
