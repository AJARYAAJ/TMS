process.env.DATABASE_URL ??= 'postgres://workora:workora@localhost:5432/workora_test';
process.env.QUEUE_PREFIX = 'workora-test-email';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.APP_URL = 'https://app.workora.test/workora';
process.env.MAIL_FROM = 'Workora <notify@workora.test>';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { ParsedMail, simpleParser } from 'mailparser';
import { Client } from 'pg';
import { SMTPServer } from 'smtp-server';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { loadConfig } from '../src/config';
import { effectivePrefs, UnsubscribeTokens } from '../src/modules/email/email-prefs';
import { renderNotificationEmail } from '../src/modules/email/email-templates';

jest.setTimeout(60_000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('email preferences & tokens (unit)', () => {
  it('fills defaults and applies sparse overrides', () => {
    expect(effectivePrefs({})).toMatchObject({ enabled: true, categories: { assigned: true, mentioned: true, comments: false, status: false } });
    expect(effectivePrefs({ comments: true, enabled: false })).toMatchObject({ enabled: false, categories: { comments: true } });
  });

  it('signs and verifies unsubscribe tokens, rejecting tampering', () => {
    const t = new UnsubscribeTokens('secret');
    const id = '6f1c2f0e-8a4b-4c1e-9a53-2f4f7b1d9a10';
    const token = t.sign(id, 'comments');
    expect(t.verify(token)).toEqual({ userId: id, category: 'comments' });
    expect(t.verify(t.sign(id, 'all'))).toEqual({ userId: id, category: 'all' });
    const forged = `${Buffer.from(`${id}:assigned`).toString('base64url')}.${token.split('.')[1]}`;
    expect(t.verify(forged)).toBeNull();
    expect(new UnsubscribeTokens('other').verify(token)).toBeNull();
    expect(t.verify('garbage')).toBeNull();
  });

  it('escapes user content and only links http(s) URLs', () => {
    const { html, text } = renderNotificationEmail({
      orgName: 'Acme <Inc>',
      heading: 'Ivy assigned <b>APP-1</b>',
      body: 'Line one\n<img src=x onerror=alert(1)>',
      task: { key: 'APP-1', title: '<script>alert(1)</script>' },
      cta: { label: 'Open', url: 'javascript:alert(1)' },
      reason: 'a task was assigned to you',
      preferencesUrl: 'https://app.test/settings',
    });
    expect(html).not.toMatch(/<script>|<img|<b>/);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Line one<br>');
    expect(html).not.toContain('javascript:');
    expect(text).toContain('Ivy assigned <b>APP-1</b>');
  });

  it('uses the first letter of the actor name for the avatar', () => {
    const base = { orgName: 'A', heading: 'h', cta: { label: 'Open', url: 'https://x.test' }, reason: 'r', preferencesUrl: 'https://x.test' };
    expect(renderNotificationEmail({ ...base, actorName: '↻ Recurring task' }).html).toMatch(/>R<\/div>/);
    expect(renderNotificationEmail({ ...base, actorName: null }).html).toMatch(/>W<\/div>/);
  });
});

describe('SMTP notification emails (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  let token: string;
  let memberToken: string;
  let maxId: string;
  let bounceId: string;
  let flakyId: string;
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

  const inbox: { mail: ParsedMail; envelope: { from: string; to: string[] }; user?: string }[] = [];
  const authUsers: string[] = [];
  let flakyFailures = 0;
  let smtp: SMTPServer;

  const header = (mail: ParsedMail, name: string) => mail.headerLines.find((h) => h.key === name)?.line.replace(/^[^:]+:\s*/, '');
  const mailTo = (addr: string) => inbox.filter((m) => m.envelope.to.includes(addr));
  const waitFor = async (fn: () => boolean, ms = 8000) => {
    const start = Date.now();
    while (!fn() && Date.now() - start < ms) await sleep(100);
    return fn();
  };
  const deliveries = async () => (await http().get('/api/v1/email/status').set(auth()).expect(200)).body.data.deliveries as any[];

  beforeAll(async () => {
    const pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    await pg.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await pg.end();

    smtp = new SMTPServer({
      disabledCommands: ['STARTTLS'],
      allowInsecureAuth: true,
      authMethods: ['PLAIN', 'LOGIN'],
      logger: false,
      onAuth(a, _s, cb) {
        authUsers.push(a.username!);
        return a.username === 'mailer' && a.password === 's3cret' ? cb(null, { user: a.username }) : cb(new Error('Invalid login'));
      },
      onRcptTo(addr, _s, cb) {
        if (addr.address === 'bounce@mail.test') return cb(Object.assign(new Error('Mailbox unavailable'), { responseCode: 550 }));
        if (addr.address === 'flaky@mail.test' && flakyFailures++ === 0) return cb(Object.assign(new Error('Try again later'), { responseCode: 451 }));
        cb();
      },
      onData(stream, session, cb) {
        simpleParser(stream).then((mail) => {
          inbox.push({ mail, envelope: { from: (session.envelope.mailFrom as any).address, to: session.envelope.rcptTo.map((r) => r.address) }, user: session.user as string });
          cb();
        }, cb);
      },
    });
    await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', r));
    process.env.SMTP_URL = `smtp://mailer:s3cret@127.0.0.1:${(smtp.server.address() as AddressInfo).port}`;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    await configureApp(app, { ...loadConfig(), realtimeRedisAdapter: false });
    await app.init();

    token = (await http().post('/api/v1/auth/register').send({ name: 'Ivy Mail', email: 'ivy@mail.test', password: 'password123', organizationName: 'Mail Co' }).expect(201)).body.data.token;
    for (const [name, email] of [['Max', 'max@mail.test'], ['Bo Bounce', 'bounce@mail.test'], ['Flo Flaky', 'flaky@mail.test']]) {
      await http().post('/api/v1/organizations/current/members').set(auth()).send({ email, name, role: 'MEMBER', password: 'password123' }).expect(201);
    }
    memberToken = (await http().post('/api/v1/auth/login').send({ email: 'max@mail.test', password: 'password123' }).expect(200)).body.data.token;
    const users = (await http().get('/api/v1/users').set(auth()).expect(200)).body.data as { id: string; email: string }[];
    maxId = users.find((u) => u.email === 'max@mail.test')!.id;
    bounceId = users.find((u) => u.email === 'bounce@mail.test')!.id;
    flakyId = users.find((u) => u.email === 'flaky@mail.test')!.id;
    await http().post('/api/v1/projects').set(auth()).send({ name: 'App', key: 'APP' }).expect(201);
    // "Added to a workspace" emails from setup; start each test from an empty inbox.
    await waitFor(() => inbox.length >= 3);
    inbox.length = 0;
  });

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((r) => (smtp ? smtp.close(() => r()) : r()));
    delete process.env.SMTP_URL;
    delete process.env.MAIL_FROM;
  });

  const task = async (title: string, extra: Record<string, unknown> = {}) => (await http().post('/api/v1/tasks').set(auth()).send({ projectId: 'APP', title, ...extra }).expect(201)).body.data;

  it('sends an authenticated, branded assignment email with text + HTML and one-click unsubscribe', async () => {
    const t = await task('Ship <new> onboarding & tour');
    await http().patch(`/api/v1/tasks/${t.key}`).set(auth()).send({ assigneeId: maxId }).expect(200);
    expect(await waitFor(() => mailTo('max@mail.test').length === 1)).toBe(true);
    const { mail, envelope, user } = mailTo('max@mail.test')[0];
    expect(user).toBe('mailer');
    expect(envelope.from).toBe('notify@workora.test');
    expect(mail.from?.text).toContain('Workora');
    expect(mail.subject).toBe(`Ivy Mail assigned ${t.key} to you`);
    expect(mail.html).toContain('Ship &lt;new&gt; onboarding &amp; tour');
    expect(mail.html).toContain(`https://app.workora.test/workora/projects/APP/board?task=${t.key}`);
    expect(mail.html).toContain('Mail Co');
    expect(mail.text).toContain(`Open ${t.key}: https://app.workora.test/workora/projects/APP/board?task=${t.key}`);
    expect(mail.text).toContain('because a task was assigned to you');
    const listUnsub = String(header(mail, 'list-unsubscribe'));
    expect(listUnsub).toMatch(/^<https:\/\/app\.workora\.test\/api\/v1\/email\/unsubscribe\?token=/);
    expect(header(mail, 'list-unsubscribe-post')).toBe('List-Unsubscribe=One-Click');
    expect(mail.html).toContain('https://app.workora.test/workora/unsubscribe?token=');
  });

  it('respects defaults: plain comments stay in-app, @mentions are emailed', async () => {
    const t = await task('Pricing page', { assigneeId: maxId });
    await waitFor(() => mailTo('max@mail.test').length === 2);
    inbox.length = 0;
    await http().post(`/api/v1/tasks/${t.key}/comments`).set(auth()).send({ body: 'Looks good overall' }).expect(201);
    await http().post(`/api/v1/tasks/${t.key}/comments`).set(auth()).send({ body: '@max can you check the copy?' }).expect(201);
    expect(await waitFor(() => mailTo('max@mail.test').length === 1)).toBe(true);
    await sleep(500);
    const mails = mailTo('max@mail.test');
    expect(mails).toHaveLength(1);
    expect(mails[0].mail.subject).toBe(`Ivy Mail mentioned you in ${t.key}`);
    expect(mails[0].mail.text).toContain('@max can you check the copy?');
  });

  it('lets users opt into categories, and switch all email off', async () => {
    const me = (await http().get('/api/v1/email/preferences').set(auth(memberToken)).expect(200)).body.data;
    expect(me).toMatchObject({ email: 'max@mail.test', enabled: true, categories: { assigned: true, comments: false } });
    expect(me.options.find((o: any) => o.key === 'comments')).toMatchObject({ label: 'Comments on tasks I watch', default: false });

    await http().patch('/api/v1/email/preferences').set(auth(memberToken)).send({ categories: { nope: true } }).expect(400);
    await http().patch('/api/v1/email/preferences').set(auth(memberToken)).send({ categories: { comments: 'yes' } }).expect(400);
    const updated = (await http().patch('/api/v1/email/preferences').set(auth(memberToken)).send({ categories: { comments: true } }).expect(200)).body.data;
    expect(updated.categories).toMatchObject({ comments: true, assigned: true });

    inbox.length = 0;
    const t = await task('Footer links', { assigneeId: maxId });
    await http().post(`/api/v1/tasks/${t.key}/comments`).set(auth()).send({ body: 'Added the legal links' }).expect(201);
    expect(await waitFor(() => mailTo('max@mail.test').some((m) => m.mail.subject === `Ivy Mail commented on ${t.key}`))).toBe(true);

    await http().patch('/api/v1/email/preferences').set(auth(memberToken)).send({ enabled: false }).expect(200);
    inbox.length = 0;
    await task('Muted task', { assigneeId: maxId });
    await sleep(1200);
    expect(mailTo('max@mail.test')).toHaveLength(0);
    // Notifications still arrive in-app.
    const notes = (await http().get('/api/v1/notifications').set(auth(memberToken)).expect(200)).body.data;
    expect(notes[0].title).toContain('assigned');
    await http().patch('/api/v1/email/preferences').set(auth(memberToken)).send({ enabled: true, categories: { comments: false } }).expect(200);
  });

  it('unsubscribes from one category via the signed link (page flow and RFC 8058 one-click)', async () => {
    inbox.length = 0;
    await task('Unsub me', { assigneeId: maxId });
    await waitFor(() => mailTo('max@mail.test').length === 1);
    const url = new URL(String(header(mailTo('max@mail.test')[0].mail, 'list-unsubscribe')).slice(1, -1));
    const tok = url.searchParams.get('token')!;

    const peek = (await http().get('/api/v1/email/unsubscribe').query({ token: tok }).expect(200)).body.data;
    expect(peek).toMatchObject({ email: 'm••@mail.test', category: 'assigned', label: 'Assigned to me', subscribed: true });
    await http().get('/api/v1/email/unsubscribe').query({ token: tok.slice(0, -2) + 'xx' }).expect(400);

    // One-click, as a mail provider would send it: no auth, form body.
    await http().post(`/api/v1/email/unsubscribe?token=${encodeURIComponent(tok)}`).type('form').send('List-Unsubscribe=One-Click').expect(200);
    const prefs = (await http().get('/api/v1/email/preferences').set(auth(memberToken)).expect(200)).body.data;
    expect(prefs.categories.assigned).toBe(false);
    expect(prefs.categories.mentioned).toBe(true);
    expect((await http().get('/api/v1/email/unsubscribe').query({ token: tok }).expect(200)).body.data.subscribed).toBe(false);

    inbox.length = 0;
    await task('No mail for this', { assigneeId: maxId });
    await sleep(1000);
    expect(mailTo('max@mail.test')).toHaveLength(0);
    await http().patch('/api/v1/email/preferences').set(auth(memberToken)).send({ categories: { assigned: true } }).expect(200);
  });

  it('does not retry permanent SMTP rejections and logs them', async () => {
    await task('Bounce this', { assigneeId: bounceId });
    const failed = await (async () => {
      for (let i = 0; i < 60; i++) {
        const d = (await deliveries()).find((x) => x.recipient === 'bounce@mail.test' && x.category === 'assigned');
        if (d) return d;
        await sleep(100);
      }
    })();
    expect(failed).toMatchObject({ status: 'failed', attempts: 1 });
    expect(failed.error).toMatch(/550/);
  });

  it('retries transient failures with backoff', async () => {
    flakyFailures = 0; // the first delivery attempt to this mailbox gets a 451
    await task('Flaky inbox', { assigneeId: flakyId });
    expect(await waitFor(() => mailTo('flaky@mail.test').some((m) => m.mail.subject?.includes('assigned')), 15000)).toBe(true);
    const sent = (await deliveries()).find((x) => x.recipient === 'flaky@mail.test' && x.category === 'assigned');
    expect(sent).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('admin status shows the transport (never the password) and recent deliveries; test email goes out', async () => {
    await http().get('/api/v1/email/status').set(auth(memberToken)).expect(403);
    await http().post('/api/v1/email/test').set(auth(memberToken)).expect(403);
    const status = (await http().get('/api/v1/email/status').set(auth()).expect(200)).body.data;
    expect(status).toMatchObject({ transport: 'smtp', host: '127.0.0.1', authenticated: true, from: 'Workora <notify@workora.test>' });
    expect(JSON.stringify(status)).not.toContain('s3cret');
    expect(status.last7Days.sent).toBeGreaterThan(3);
    expect(status.last7Days.failed).toBeGreaterThanOrEqual(1);

    inbox.length = 0;
    const res = (await http().post('/api/v1/email/test').set(auth()).expect(200)).body.data;
    expect(res).toMatchObject({ sent: true, transport: 'smtp', to: 'ivy@mail.test' });
    expect(mailTo('ivy@mail.test')[0].mail.subject).toBe('Workora test email');
    expect(authUsers.every((u) => u === 'mailer')).toBe(true);
  });
});
