process.env.DATABASE_URL ??= 'postgres://workora:workora@localhost:5432/workora_test';
process.env.QUEUE_PREFIX = 'workora-test-int';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.APP_URL = 'https://app.workora.test/workora';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { loadConfig } from '../src/config';
import { closingKeys, extractKeys } from '../src/modules/integrations/shared';

jest.setTimeout(60_000);

const eventually = async <T>(fn: () => Promise<T>, check: (v: T) => boolean, timeoutMs = 6000): Promise<T> => {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (check(v) || Date.now() - start > timeoutMs) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
};

describe('key parsing', () => {
  it('finds keys in text and branch names', () => {
    expect(extractKeys('Fix ECOM-12 and ops-3', 'feature/web-7-hero')).toEqual(['ECOM-12', 'OPS-3', 'WEB-7']);
  });
  it('finds keys after closing keywords only', () => {
    expect(closingKeys('Fixes ECOM-12, refs OPS-3, closes #WEB-7\nresolved: api-9')).toEqual(['ECOM-12', 'WEB-7', 'API-9']);
  });
});

describe('Slack & GitHub integrations (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  let token: string;
  let memberToken: string;
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const get = async (path: string) => (await http().get(`/api/v1${path}`).set(auth()).expect(200)).body.data;
  const task = async (title: string, extra: Record<string, unknown> = {}) => (await http().post('/api/v1/tasks').set(auth()).send({ projectId: 'APP', title, ...extra }).expect(201)).body.data;

  const slackPosts: any[] = [];
  let slackServer: Server;
  let slackUrl: string;

  beforeAll(async () => {
    const pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    await pg.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await pg.end();
    slackServer = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        slackPosts.push(JSON.parse(body));
        res.writeHead(200).end('ok');
      });
    });
    await new Promise<void>((r) => slackServer.listen(0, r));
    slackUrl = `http://127.0.0.1:${(slackServer.address() as AddressInfo).port}/services/T000/B000/XXX`;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    await configureApp(app, { ...loadConfig(), realtimeRedisAdapter: false });
    await app.init();
    token = (await http().post('/api/v1/auth/register').send({ name: 'Ivy Int', email: 'ivy@int.test', password: 'password123', organizationName: 'Int' }).expect(201)).body.data.token;
    await http().post('/api/v1/organizations/current/members').set(auth()).send({ email: 'max@int.test', name: 'Max', role: 'MEMBER', password: 'password123' }).expect(201);
    memberToken = (await http().post('/api/v1/auth/login').send({ email: 'max@int.test', password: 'password123' }).expect(200)).body.data.token;
    await http().post('/api/v1/projects').set(auth()).send({ name: 'App', key: 'APP' }).expect(201);
    await http().post('/api/v1/projects').set(auth()).send({ name: 'Other', key: 'OTH' }).expect(201);
  });

  afterAll(async () => {
    await app?.close();
    slackServer?.close();
  });

  describe('Slack', () => {
    let integrationId: string;
    const signingSecret = 'slack-signing-secret-123';
    const slash = (text: string, opts: { secret?: string; ts?: number } = {}) => {
      const body = new URLSearchParams({ command: '/workora', text, user_name: 'ivy.slack', team_domain: 'int' }).toString();
      const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
      const sig = `v0=${createHmac('sha256', opts.secret ?? signingSecret).update(`v0:${ts}:${body}`).digest('hex')}`;
      return http()
        .post(`/api/v1/hooks/slack/${integrationId}/commands`)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', ts)
        .set('X-Slack-Signature', sig)
        .send(body);
    };

    it('only admins connect Slack; secrets and URLs are not echoed back', async () => {
      await http().post('/api/v1/integrations/slack').set(auth(memberToken)).send({ name: 'x', webhookUrl: slackUrl }).expect(403);
      const created = (
        await http()
          .post('/api/v1/integrations/slack')
          .set(auth())
          .send({ name: '#app-dev', webhookUrl: slackUrl, projectId: 'APP', events: ['TASK_CREATED', 'TASK_UPDATED', 'COMMENT_CREATED', 'DEV_LINKED'], commandProjectId: 'APP', signingSecret })
          .expect(201)
      ).body.data;
      integrationId = created.id;
      expect(created.config.webhookUrl.endsWith('…')).toBe(true);
      expect(created.secret).toBeUndefined();
      expect(created.hookPath).toBe(`/api/v1/hooks/slack/${created.id}/commands`);
      const list = await get('/integrations');
      expect(list[0]).toMatchObject({ provider: 'slack', slashCommandEnabled: true });
    });

    it('posts formatted messages for subscribed events in its project only', async () => {
      const t = await task('Hero banner copy', { priority: 'HIGH' });
      await http().post('/api/v1/tasks').set(auth()).send({ projectId: 'OTH', title: 'Not for this channel' }).expect(201);
      await http().patch(`/api/v1/tasks/${t.key}`).set(auth()).send({ status: 'IN_PROGRESS' }).expect(200);
      await http().patch(`/api/v1/tasks/${t.key}`).set(auth()).send({ priority: 'LOW' }).expect(200); // not a state change: no post
      await http().post(`/api/v1/tasks/${t.key}/comments`).set(auth()).send({ body: 'Draft is <ready> & reviewed' }).expect(201);
      const posts = await eventually(async () => slackPosts, (p) => p.length >= 3);
      await new Promise((r) => setTimeout(r, 400));
      const texts = slackPosts.map((p) => p.blocks[0].text.text);
      expect(texts).toHaveLength(3);
      expect(texts[0]).toBe(`🆕 *Ivy Int* created <https://app.workora.test/workora/projects/APP/board?task=${t.key}|${t.key} Hero banner copy>`);
      expect(texts[1]).toContain('moved');
      expect(texts[1]).toContain('*In progress*');
      expect(texts[2]).toContain('&lt;ready&gt; &amp; reviewed');
      expect(posts.every((p) => !JSON.stringify(p).includes('Not for this channel'))).toBe(true);
      expect((await get('/integrations'))[0].lastStatus).toBe('delivered');
    });

    it('sends a test message', async () => {
      const before = slackPosts.length;
      await http().post(`/api/v1/integrations/${integrationId}/test`).set(auth()).expect(201);
      await eventually(async () => slackPosts.length, (n) => n > before);
      expect(slackPosts[slackPosts.length - 1].text).toContain('connected');
    });

    it('rejects slash commands with a bad or stale signature', async () => {
      const bad = await slash('help', { secret: 'wrong-secret-000' }).expect(401);
      expect(bad.body.error.code).toBe('INVALID_SIGNATURE');
      await slash('help', { ts: Math.floor(Date.now() / 1000) - 3600 }).expect(401);
    });

    it('/workora help | create | KEY | search', async () => {
      expect((await slash('help').expect(200)).body.text).toContain('/workora create');
      const created = (await slash('create Fix checkout timeout').expect(200)).body;
      expect(created.response_type).toBe('in_channel');
      const key = created.text.replace('Created ', '');
      const t = await get(`/tasks/${key}`);
      expect(t).toMatchObject({ title: 'Fix checkout timeout', description: 'Created from Slack by @ivy.slack' });
      const activity = await eventually(() => get(`/tasks/${key}/activity`), (a: any[]) => a.length > 0);
      expect(activity[0].actor.name).toBe('ivy.slack via Slack');

      const other = (await slash('create OTH: Ship the other thing').expect(200)).body;
      expect(other.text).toMatch(/^Created OTH-\d+$/);

      const shown = (await slash(key.toLowerCase()).expect(200)).body;
      expect(shown.blocks[0].text.text).toContain(`${key} Fix checkout timeout`);
      expect((await slash('APP-9999').expect(200)).body.text).toContain("couldn't find");

      const found = (await slash('search checkout').expect(200)).body;
      expect(found.response_type).toBe('ephemeral');
      expect(found.text).toContain(key);
      expect((await slash('dance').expect(200)).body.text).toContain('Unknown command');
    });

    it('validates Slack URLs and events', async () => {
      const res = await http().post('/api/v1/integrations/slack').set(auth()).send({ name: 'x', events: ['NOPE'] }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GitHub', () => {
    let id: string;
    let secret: string;
    const hook = (event: string, payload: unknown, sign = secret) => {
      const body = JSON.stringify(payload);
      return http()
        .post(`/api/v1/hooks/github/${id}`)
        .set('Content-Type', 'application/json')
        .set('X-GitHub-Event', event)
        .set('X-Hub-Signature-256', `sha256=${createHmac('sha256', sign).update(body).digest('hex')}`)
        .send(body);
    };
    const repository = { full_name: 'acme/app', default_branch: 'main' };
    const sender = { login: 'octocat' };
    const pr = (n: number, extra: Record<string, unknown>) => ({ number: n, html_url: `https://github.com/acme/app/pull/${n}`, user: { login: 'octocat' }, state: 'open', draft: false, merged: false, body: '', ...extra });

    it('connects a repository and reveals the webhook secret once', async () => {
      const res = (await http().post('/api/v1/integrations/github').set(auth()).send({ name: 'acme/app', repository: 'acme/app', projectId: 'APP', createTasksFromIssues: true }).expect(201)).body.data;
      id = res.id;
      secret = res.secret;
      expect(secret).toMatch(/^[0-9a-f]{48}$/);
      expect(res.config).toMatchObject({ onPrOpened: 'IN_REVIEW', onPrMerged: 'DONE', closeOnKeywords: true });
      expect((await get('/integrations')).find((i: any) => i.id === id).secret).toBeUndefined();
      await http().post('/api/v1/integrations/github').set(auth()).send({ name: 'bad', repository: 'not a repo' }).expect(400);
    });

    it('verifies signatures and answers pings', async () => {
      await hook('ping', { zen: 'Keep it logically awesome.', repository, sender }, 'nope').expect(401);
      expect((await hook('ping', { zen: 'hi', repository, sender }).expect(202)).body.data).toEqual({ ok: true, pong: true });
      expect((await hook('ping', { repository: { full_name: 'evil/repo' }, sender }).expect(202)).body.data.pong).toBe(true);
    });

    it('PR lifecycle: link by branch name → in review → merged → done', async () => {
      const t = await task('Password reset flow');
      const opened = await hook('pull_request', { action: 'opened', repository, sender, pull_request: pr(41, { title: 'Password reset', head: { ref: `${t.key.toLowerCase()}-password-reset` } }) }).expect(202);
      expect(opened.body.data.linked).toEqual([t.key]);
      let detail = await get(`/tasks/${t.key}`);
      expect(detail).toMatchObject({ status: 'IN_REVIEW', openPrs: 1 });
      expect(detail.devLinks).toEqual([expect.objectContaining({ kind: 'pull_request', externalId: 'acme/app#41', state: 'open', title: '#41 Password reset', url: 'https://github.com/acme/app/pull/41' })]);

      await hook('pull_request', { action: 'closed', repository, sender, pull_request: pr(41, { title: 'Password reset', state: 'closed', merged: true, head: { ref: `${t.key.toLowerCase()}-x` } }) }).expect(202);
      detail = await get(`/tasks/${t.key}`);
      expect(detail).toMatchObject({ status: 'DONE', openPrs: 0 });
      expect(detail.devLinks[0].state).toBe('merged');

      const activity = await eventually(() => get(`/tasks/${t.key}/activity`), (a: any[]) => a.some((x) => x.summary.includes('now merged')));
      expect(activity.find((x: any) => x.summary.startsWith('linked pull request')).actor.name).toBe('octocat via GitHub');
      // Merged PRs were announced in Slack (DEV_LINKED subscription).
      await eventually(async () => slackPosts, (p) => p.some((m) => m.blocks[0].text.text.includes('🟣 Merged')));
    });

    it('never moves a finished task backwards', async () => {
      const t = await task('Already shipped', { status: 'DONE' });
      await hook('pull_request', { action: 'opened', repository, sender, pull_request: pr(42, { title: `Follow-up for ${t.key}`, head: { ref: 'follow-up' } }) }).expect(202);
      expect((await get(`/tasks/${t.key}`)).status).toBe('DONE');
    });

    it('push: links commits and closes "fixes KEY" on the default branch only', async () => {
      const a = await task('Rate limiter');
      const b = await task('Cache headers');
      const commit = (id: string, message: string) => ({ id, message, url: `https://github.com/acme/app/commit/${id}`, author: { username: 'octocat' } });
      await hook('push', { ref: 'refs/heads/feature', repository, sender, commits: [commit('a1b2c3d4e5', `Fixes ${a.key}: token bucket`)] }).expect(202);
      expect((await get(`/tasks/${a.key}`)).status).toBe('TODO'); // not the default branch
      const res = await hook('push', { ref: 'refs/heads/main', repository, sender, commits: [commit('f6e5d4c3b2', `Fixes ${a.key}; refs ${b.key}`)] }).expect(202);
      expect(res.body.data).toEqual({ linked: [a.key, b.key], closed: [a.key] });
      expect((await get(`/tasks/${a.key}`)).status).toBe('DONE');
      expect((await get(`/tasks/${b.key}`)).status).toBe('TODO');
      const links = (await get(`/tasks/${a.key}`)).devLinks;
      expect(links.map((l: any) => l.title)).toEqual(expect.arrayContaining(['a1b2c3d Fixes ' + a.key + ': token bucket', 'f6e5d4c Fixes ' + a.key + '; refs ' + b.key]));
    });

    it('issues become tasks and closing the issue finishes the task', async () => {
      const issue = { number: 7, title: 'Login button misaligned on Safari', body: 'Steps to reproduce…', html_url: 'https://github.com/acme/app/issues/7', user: { login: 'reporter' }, state: 'open', labels: [{ name: 'bug' }] };
      const res = await hook('issues', { action: 'opened', repository, sender, issue }).expect(202);
      const key = res.body.data.created;
      const t = await get(`/tasks/${key}`);
      expect(t).toMatchObject({ title: issue.title, type: 'BUG', status: 'TODO' });
      expect(t.description).toContain('acme/app#7');
      expect(t.devLinks[0]).toMatchObject({ kind: 'issue', state: 'open' });
      await hook('issues', { action: 'opened', repository, sender, issue }).expect(202); // redelivery doesn't duplicate
      expect(await get(`/tasks?projectId=APP&q=Login button`)).toHaveLength(1);
      await hook('issues', { action: 'closed', repository, sender, issue: { ...issue, state: 'closed' } }).expect(202);
      expect(await get(`/tasks/${key}`)).toMatchObject({ status: 'DONE', devLinks: [expect.objectContaining({ state: 'closed' })] });
    });

    it('ignores other repositories and disabled integrations', async () => {
      const t = await task('Scoped');
      const res = await hook('pull_request', { action: 'opened', repository: { full_name: 'evil/fork', default_branch: 'main' }, sender, pull_request: pr(1, { title: t.key, head: { ref: 'x' } }) }).expect(202);
      expect(res.body.data.ignored).toBe('repository not configured');
      await http().patch(`/api/v1/integrations/${id}`).set(auth()).send({ enabled: false }).expect(200);
      await hook('ping', { repository, sender }).expect(404);
    });
  });
});
