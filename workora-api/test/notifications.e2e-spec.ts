process.env.DATABASE_URL ??= 'postgres://workora:workora@localhost:5432/workora_test';
process.env.QUEUE_PREFIX = 'workora-test-notifications';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.STORAGE_ROOT = `${__dirname}/../data/test-uploads`;
process.env.APP_URL = 'http://app.test/workora';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createECDH, randomBytes } from 'crypto';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import { IncomingHttpHeaders } from 'http';
import { createServer, globalAgent, Server } from 'https';
import { tmpdir } from 'os';
import { join } from 'path';
import { AddressInfo } from 'net';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { EventBus } from '../src/common/events/event-bus.service';
import { loadConfig } from '../src/config';
import { JobsProcessor } from '../src/modules/jobs/jobs.module';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ece = require('http_ece') as { decrypt(buf: Buffer, p: object): Buffer };

jest.setTimeout(60_000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const eventually = async <T>(fn: () => Promise<T>, check: (v: T) => boolean, timeoutMs = 6000): Promise<T> => {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (check(v) || Date.now() - start > timeoutMs) return v;
    await sleep(100);
  }
};

/** A browser's side of Web Push: its own key pair and auth secret, and a push service that records deliveries. */
function fakeBrowser(baseUrl: string, name: string) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const authSecret = randomBytes(16);
  return {
    name,
    subscription: { endpoint: `${baseUrl}/push/${name}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') } },
    decrypt: (body: Buffer) => JSON.parse(ece.decrypt(body, { version: 'aes128gcm', privateKey: ecdh, authSecret }).toString()),
  };
}

describe('Notifications: every feature, desktop push (e2e)', () => {
  let app: INestApplication;
  let pushServer: Server;
  let pushUrl: string;
  /** Recorded deliveries per endpoint name. */
  const received: { name: string; headers: IncomingHttpHeaders; body: Buffer }[] = [];
  /** Endpoint names the fake push service answers 410 Gone for (the browser unsubscribed). */
  const gone = new Set<string>();
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  let owner: { token: string; userId: string };
  let rahul: { token: string; userId: string };

  const task = async (title: string, extra: Record<string, unknown> = {}, token = owner.token) =>
    (await http().post('/api/v1/tasks').set(auth(token)).send({ projectId: 'APP', title, ...extra }).expect(201)).body.data;
  const notes = async (token = rahul.token) => (await http().get('/api/v1/notifications?size=100').set(auth(token)).expect(200)).body.data as any[];
  const waitForNote = (match: (n: any) => boolean, token = rahul.token) => eventually(() => notes(token), (n) => n.some(match)).then((n) => n.find(match));

  beforeAll(async () => {
    // Push services are https-only; this one has a self-signed certificate that only this test trusts.
    const dir = mkdtempSync(join(tmpdir(), 'push-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
    const cert = readFileSync(join(dir, 'cert.pem'));
    globalAgent.options.ca = [cert];
    pushServer = createServer({ key: readFileSync(join(dir, 'key.pem')), cert }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const name = req.url!.split('/').pop()!;
        if (gone.has(name)) return res.writeHead(410).end();
        received.push({ name, headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(201).end();
      });
    }).listen(0);
    pushUrl = `https://127.0.0.1:${(pushServer.address() as AddressInfo).port}`;

    const pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    await pg.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await pg.end();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    await configureApp(app, { ...loadConfig(), realtimeRedisAdapter: false });
    await app.init();

    const reg = await http().post('/api/v1/auth/register').send({ name: 'Alex Morgan', email: 'alex@n.test', password: 'password123', organizationName: 'Notify Co' }).expect(201);
    owner = { token: reg.body.data.token, userId: reg.body.data.user.id };
    await http().post('/api/v1/organizations/current/members').set(auth(owner.token)).send({ email: 'rahul@n.test', name: 'Rahul Sharma', role: 'MEMBER', password: 'password123' }).expect(201);
    const r = (await http().post('/api/v1/auth/login').send({ email: 'rahul@n.test', password: 'password123' }).expect(200)).body.data;
    rahul = { token: r.token, userId: r.user.id };
    await http().post('/api/v1/projects').set(auth(owner.token)).send({ name: 'App', key: 'APP' }).expect(201);
  });

  afterAll(async () => {
    await app?.close();
    pushServer?.close();
  });

  it('assignment, reassignment, priority, due date and state changes all notify, with categories', async () => {
    const t = await task('Checkout redesign', { assigneeId: rahul.userId });
    expect(await waitForNote((n) => n.type === 'TASK_ASSIGNED' && n.taskKey === t.key)).toMatchObject({ category: 'assigned', title: `Alex Morgan assigned ${t.key} to you` });

    await http().patch(`/api/v1/tasks/${t.key}`).set(auth(owner.token)).send({ priority: 'URGENT' }).expect(200);
    expect((await waitForNote((n) => n.type === 'TASK_CHANGED' && n.taskKey === t.key)).title).toBe(`Alex Morgan set ${t.key} to urgent priority`);

    await http().patch(`/api/v1/tasks/${t.key}`).set(auth(owner.token)).send({ dueDate: '2026-10-20' }).expect(200);
    await waitForNote((n) => n.title === `Alex Morgan moved the due date of ${t.key} to Oct 20`);

    // The assignee hears when someone else moves their task.
    await http().patch(`/api/v1/tasks/${t.key}`).set(auth(owner.token)).send({ status: 'IN_PROGRESS' }).expect(200);
    expect(await waitForNote((n) => n.type === 'TASK_STATUS_CHANGED' && n.taskKey === t.key)).toMatchObject({ category: 'status', title: `Alex Morgan moved ${t.key} to in progress` });

    // Taken off the task.
    await http().patch(`/api/v1/tasks/${t.key}`).set(auth(owner.token)).send({ assigneeId: null }).expect(200);
    expect(await waitForNote((n) => n.type === 'TASK_UNASSIGNED')).toMatchObject({ category: 'assigned', title: `Alex Morgan took you off ${t.key}` });

    // Your own actions never notify you.
    await http().patch(`/api/v1/tasks/${t.key}`).set(auth(rahul.token)).send({ priority: 'LOW' }).expect(200);
    await sleep(400);
    expect((await notes(owner.token)).filter((n) => n.taskKey === t.key && n.type === 'TASK_CHANGED')).toHaveLength(1); // owner watches; rahul's change
  });

  it('files, blockers, trash and restore reach the people on the task', async () => {
    const a = await task('API contract', { assigneeId: rahul.userId });
    const b = await task('Mobile client');
    // Attachments.
    const init = (await http().post(`/api/v1/tasks/${a.key}/attachments/upload-url`).set(auth(owner.token)).send({ fileName: 'contract.pdf', contentType: 'application/pdf', size: 3 }).expect(201)).body.data;
    await http().put(init.uploadUrl).set('Content-Type', 'application/pdf').send('pdf').expect(200);
    await http().post(`/api/v1/tasks/${a.key}/attachments`).set(auth(owner.token)).send({ storageKey: init.storageKey, fileName: 'contract.pdf', contentType: 'application/pdf' }).expect(201);
    expect(await waitForNote((n) => n.type === 'ATTACHMENT_ADDED')).toMatchObject({ category: 'changes', title: `Alex Morgan attached contract.pdf to ${a.key}` });

    // b blocks a: a's assignee learns their task now waits.
    await http().post(`/api/v1/tasks/${b.key}/links`).set(auth(owner.token)).send({ targetId: a.key, type: 'BLOCKS' }).expect(201);
    expect(await waitForNote((n) => n.type === 'TASK_BLOCKED')).toMatchObject({ title: `${a.key} is now blocked by ${b.key}`, link: `/projects/APP/board?task=${a.key}` });

    await http().delete(`/api/v1/tasks/${a.key}`).set(auth(owner.token)).expect(200);
    const trashed = await waitForNote((n) => n.type === 'TASK_TRASHED');
    expect(trashed).toMatchObject({ link: '/trash', taskKey: null, title: `Alex Morgan moved ${a.key} to the trash` });
    await http().post(`/api/v1/trash/${a.id}/restore`).set(auth(owner.token)).expect(200);
    await waitForNote((n) => n.type === 'TASK_RESTORED' && n.taskKey === a.key);
  });

  it('due-tomorrow reminders fire once per due date', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const t = await task('Send invoices', { assigneeId: rahul.userId, dueDate: tomorrow });
    const first = await app.get(JobsProcessor).scanOverdue();
    expect(first.dueSoon).toBeGreaterThanOrEqual(1);
    expect((await app.get(JobsProcessor).scanOverdue()).dueSoon).toBe(0);
    expect(await waitForNote((n) => n.type === 'TASK_DUE_SOON' && n.taskKey === t.key)).toMatchObject({ category: 'dueSoon', title: `${t.key} is due tomorrow` });
  });

  it('form responses, goals, recurring tasks and GitHub activity notify their owners', async () => {
    // Rahul owns a form; a public response notifies him even though the task is created in his name.
    const form = (await http().post('/api/v1/projects/APP/forms').set(auth(rahul.token)).send({ name: 'Bug reports', questions: [{ kind: 'title', label: 'What broke?' }] }).expect(201)).body.data;
    await http().post(`/api/v1/public/forms/${form.slug}`).send({ answers: { title: 'Login button missing' } }).expect(201);
    expect((await waitForNote((n) => n.type === 'FORM_SUBMITTED')).title).toMatch(/^New response to “Bug reports” → APP-\d+$/);

    const goal = (await http().post('/api/v1/goals').set(auth(owner.token)).send({ title: 'Faster checkout', ownerId: rahul.userId }).expect(201)).body.data;
    await http().patch(`/api/v1/goals/${goal.id}`).set(auth(owner.token)).send({ status: 'AT_RISK' }).expect(200);
    expect(await waitForNote((n) => n.type === 'GOAL_UPDATED')).toMatchObject({ category: 'goals', link: '/goals', body: '0% · at risk' });

    const weekly = await task('Weekly report', { assigneeId: rahul.userId, dueDate: '2026-10-05', recurrence: { freq: 'WEEKLY' } });
    await http().patch(`/api/v1/tasks/${weekly.key}`).set(auth(rahul.token)).send({ status: 'DONE' }).expect(200);
    const next = await waitForNote((n) => n.type === 'TASK_RECURRED');
    expect(next.title).toMatch(/^Next APP-\d+ is ready · due Oct 12$/);
    expect(next.link).toMatch(/^\/projects\/APP\/board\?task=APP-\d+$/);

    const pr = await task('Payment retries', { assigneeId: rahul.userId });
    const link = (state: string) => ({ kind: 'pull_request', state, title: 'Retry failed payments', externalId: '42' });
    // As the GitHub integration publishes it (its webhook handling has its own suite).
    const github = (data: object) => app.get(EventBus).publish('DEV_LINKED', { organizationId: org, actor: { id: owner.userId, name: 'octocat via GitHub' }, data: { task: pr, ...data } });
    const org = await orgId();
    github({ link: link('open'), isNew: true });
    expect((await waitForNote((n) => n.type === 'DEV_LINKED')).title).toBe(`Pull request #42 linked to ${pr.key}`);
    github({ link: link('open'), isNew: false });
    github({ link: link('merged'), isNew: false });
    await waitForNote((n) => n.title === `Pull request #42 merged for ${pr.key}`);
    expect((await notes()).filter((n) => n.type === 'DEV_LINKED')).toHaveLength(2); // the plain update is not news
  });

  const orgId = async () => (await http().get('/api/v1/organizations/current').set(auth(owner.token)).expect(200)).body.data.id as string;

  describe('desktop (Web Push)', () => {
    it('gives browsers a VAPID key, stores subscriptions and validates them', async () => {
      const cfg = (await http().get('/api/v1/notifications/push').set(auth(rahul.token)).expect(200)).body.data;
      expect(cfg.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/); // uncompressed P-256 point, base64url
      expect(cfg).toMatchObject({ enabled: true, devices: [] });
      expect(cfg.categories).toMatchObject({ assigned: true, comments: true, goals: true });
      expect(cfg.options.map((o: any) => o.key)).toEqual(expect.arrayContaining(['dueSoon', 'forms', 'development', 'changes', 'goals']));
      // The key pair is generated once and kept (sealed) in the database.
      expect((await http().get('/api/v1/notifications/push').set(auth(owner.token)).expect(200)).body.data.publicKey).toBe(cfg.publicKey);

      await http().post('/api/v1/notifications/push/subscriptions').set(auth(rahul.token)).send({ endpoint: 'http://push.example/x', keys: { p256dh: 'a', auth: 'b' } }).expect(400);
      await http().post('/api/v1/notifications/push/subscriptions').set(auth(rahul.token)).send({ endpoint: `${pushUrl}/push/x` }).expect(400);
      await http().post('/api/v1/notifications/push/test').set(auth(rahul.token)).expect(400); // no devices yet
    });

    it('delivers end-to-end encrypted, VAPID-signed pushes that open the right page', async () => {
      const laptop = fakeBrowser(pushUrl, 'rahul-laptop');
      await http().post('/api/v1/notifications/push/subscriptions').set(auth(rahul.token)).send({ ...laptop.subscription, device: 'Chrome on macOS' }).expect(201);
      const { publicKey } = (await http().get('/api/v1/notifications/push').set(auth(rahul.token)).expect(200)).body.data;

      received.length = 0;
      const test = (await http().post('/api/v1/notifications/push/test').set(auth(rahul.token)).expect(200)).body.data;
      expect(test).toEqual({ sent: 1, failed: 0 });
      const delivery = received[0];
      expect(delivery.headers['content-encoding']).toBe('aes128gcm');
      expect(delivery.headers.authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${publicKey}$`));
      expect(delivery.body.toString()).not.toContain('Desktop notifications work'); // encrypted
      expect(laptop.decrypt(delivery.body)).toMatchObject({ title: 'Desktop notifications work', url: 'http://app.test/workora/settings', category: 'test' });

      received.length = 0;
      const t = await task('Refund flow', { assigneeId: rahul.userId });
      await eventually(async () => received.length, (n) => n > 0);
      const msg = laptop.decrypt(received[0].body);
      expect(msg).toMatchObject({ title: `Alex Morgan assigned ${t.key} to you`, body: 'Refund flow', category: 'assigned', organization: 'Notify Co' });
      expect(msg.url).toBe(`http://app.test/workora/projects/APP/board?task=${t.key}&org=${await orgId()}`);
      expect(received[0].headers.urgency).toBe('high');
      const devices = (await http().get('/api/v1/notifications/push').set(auth(rahul.token)).expect(200)).body.data.devices;
      expect(devices).toEqual([expect.objectContaining({ device: 'Chrome on macOS', lastSuccessAt: expect.any(String) })]);
    });

    it('respects per-category desktop preferences and the master switch', async () => {
      await http().patch('/api/v1/notifications/push').set(auth(rahul.token)).send({ categories: { nope: true } }).expect(400);
      const prefs = (await http().patch('/api/v1/notifications/push').set(auth(rahul.token)).send({ categories: { assigned: false } }).expect(200)).body.data;
      expect(prefs.categories).toMatchObject({ assigned: false, mentioned: true });

      received.length = 0;
      const t = await task('Quiet task', { assigneeId: rahul.userId });
      await waitForNote((n) => n.taskKey === t.key); // still in-app
      await sleep(400);
      expect(received).toHaveLength(0);

      await http().post(`/api/v1/tasks/${t.key}/comments`).set(auth(owner.token)).send({ body: `@rahul@n.test can you check?` }).expect(201);
      await eventually(async () => received.length, (n) => n > 0);
      expect(received.map((r) => r.name)).toEqual(['rahul-laptop']);

      await http().patch('/api/v1/notifications/push').set(auth(rahul.token)).send({ enabled: false }).expect(200);
      received.length = 0;
      await http().post(`/api/v1/tasks/${t.key}/comments`).set(auth(owner.token)).send({ body: `@rahul@n.test again` }).expect(201);
      await sleep(500);
      expect(received).toHaveLength(0);
      await http().patch('/api/v1/notifications/push').set(auth(rahul.token)).send({ enabled: true, categories: { assigned: true } }).expect(200);
    });

    it('security notices always reach the desktop, in every workspace', async () => {
      received.length = 0;
      app.get(EventBus).securityNotice({ userId: rahul.userId, title: 'Two-factor authentication is on', body: 'You turned it on.' });
      await eventually(async () => received.length, (n) => n > 0);
      expect(received.map((r) => r.name)).toEqual(['rahul-laptop']);
      expect(await waitForNote((n) => n.type === 'SECURITY')).toMatchObject({ category: 'security', link: '/settings' });
    });

    it('drops subscriptions the push service says are gone, and a browser moves to whoever signs in', async () => {
      const shared = fakeBrowser(pushUrl, 'shared-pc');
      await http().post('/api/v1/notifications/push/subscriptions').set(auth(owner.token)).send(shared.subscription).expect(201);
      await http().post('/api/v1/notifications/push/subscriptions').set(auth(rahul.token)).send(shared.subscription).expect(201);
      expect((await http().get('/api/v1/notifications/push').set(auth(owner.token)).expect(200)).body.data.devices).toEqual([]);
      expect((await http().get('/api/v1/notifications/push').set(auth(rahul.token)).expect(200)).body.data.devices).toHaveLength(2);

      gone.add('rahul-laptop');
      const r = (await http().post('/api/v1/notifications/push/test').set(auth(rahul.token)).expect(200)).body.data;
      expect(r).toEqual({ sent: 1, failed: 1 });
      expect((await http().get('/api/v1/notifications/push').set(auth(rahul.token)).expect(200)).body.data.devices.map((d: any) => d.endpoint)).toEqual([shared.subscription.endpoint]);

      // Unsubscribing only touches your own browsers.
      expect((await http().delete('/api/v1/notifications/push/subscriptions').set(auth(owner.token)).send({ endpoint: shared.subscription.endpoint }).expect(200)).body.data.removed).toBe(0);
      expect((await http().delete('/api/v1/notifications/push/subscriptions').set(auth(rahul.token)).send({ endpoint: shared.subscription.endpoint }).expect(200)).body.data.removed).toBe(1);
    });
  });
});
