process.env.DATABASE_URL ??= 'postgres://workora:workora@localhost:5432/workora_test';
process.env.QUEUE_PREFIX = 'workora-test';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.STORAGE_ROOT = `${__dirname}/../data/test-uploads`;

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { loadConfig } from '../src/config';

jest.setTimeout(60_000);

const eventually = async <T>(fn: () => Promise<T>, check: (v: T) => boolean, timeoutMs = 5000): Promise<T> => {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (check(v) || Date.now() - start > timeoutMs) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
};

describe('Workora API (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const http = () => request(app.getHttpServer());

  let owner: { token: string; userId: string; orgId: string };
  let rahul: { token: string; userId: string };
  let viewer: { token: string };
  let projectId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = async (email: string, password = 'password123') => {
    const res = await http().post('/api/v1/auth/login').send({ email, password }).expect(200);
    return res.body.data;
  };

  beforeAll(async () => {
    const pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    await pg.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await pg.end();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    await configureApp(app, loadConfig());
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace('[::1]', 'localhost');

    const reg = await http()
      .post('/api/v1/auth/register')
      .send({ name: 'Alex Morgan', email: 'alex@acme.test', password: 'password123', organizationName: 'Acme' })
      .expect(201);
    owner = { token: reg.body.data.token, userId: reg.body.data.user.id, orgId: reg.body.data.organization.id };

    for (const [email, name, role] of [
      ['rahul@acme.test', 'Rahul Sharma', 'MEMBER'],
      ['vic@acme.test', 'Vic Viewer', 'VIEWER'],
    ]) {
      await http().post('/api/v1/organizations/current/members').set(auth(owner.token)).send({ email, name, role, password: 'password123' }).expect(201);
    }
    const r = await login('rahul@acme.test');
    rahul = { token: r.token, userId: r.user.id };
    viewer = { token: (await login('vic@acme.test')).token };
  });

  afterAll(async () => {
    await app?.close();
  });

  it('wraps responses in the standard envelope', async () => {
    const res = await http().get('/api/v1/auth/me').set(auth(owner.token)).expect(200);
    expect(res.body).toEqual({ success: true, data: expect.objectContaining({ role: 'OWNER' }), meta: {} });
  });

  it('returns standard errors (401, 404, validation, unversioned)', async () => {
    const unauth = await http().get('/api/v1/tasks').expect(401);
    expect(unauth.body).toEqual({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    const missing = await http().get('/api/v1/tasks/NOPE-1').set(auth(owner.token)).expect(404);
    expect(missing.body.error.code).toBe('TASK_NOT_FOUND');
    const invalid = await http().post('/api/v1/projects').set(auth(owner.token)).send({ name: '' }).expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalid.body.error.details.name).toBeDefined();
    await http().get('/api/tasks').set(auth(owner.token)).expect(404);
  });

  it('creates projects and runs the project-setup background job', async () => {
    const res = await http().post('/api/v1/projects').set(auth(owner.token)).send({ name: 'E-Commerce Platform', key: 'ECOM' }).expect(201);
    projectId = res.body.data.id;
    expect(res.body.data.key).toBe('ECOM');
    const dup = await http().post('/api/v1/projects').set(auth(owner.token)).send({ name: 'Other', key: 'ECOM' }).expect(409);
    expect(dup.body.error.code).toBe('PROJECT_KEY_TAKEN');
    const auto = await http().post('/api/v1/projects').set(auth(owner.token)).send({ name: 'Mobile App' }).expect(201);
    expect(auto.body.data.key).toBe('MA');

    const sprints = await eventually(
      async () => (await http().get('/api/v1/projects/ECOM/sprints').set(auth(owner.token))).body.data,
      (s: any[]) => s.length > 0,
    );
    expect(sprints).toEqual([expect.objectContaining({ name: 'Sprint 1', status: 'PLANNED' })]);
  });

  it('creates tasks with human keys and supports PATCH semantics', async () => {
    const created = await http()
      .post('/api/v1/tasks')
      .set(auth(owner.token))
      .send({ projectId: 'ECOM', title: 'Implement Payment API', priority: 'HIGH', assigneeId: rahul.userId })
      .expect(201);
    expect(created.body.data).toMatchObject({ key: 'ECOM-1', status: 'TODO', position: 0, assignee: { name: 'Rahul Sharma' } });

    const byKey = await http().get('/api/v1/tasks/ecom-1').set(auth(owner.token)).expect(200);
    expect(byKey.body.data.id).toBe(created.body.data.id);

    const patched = await http().patch('/api/v1/tasks/ECOM-1').set(auth(owner.token)).send({ description: 'Stripe', assigneeId: null }).expect(200);
    expect(patched.body.data).toMatchObject({ description: 'Stripe', assignee: null, title: 'Implement Payment API' });
    await http().patch('/api/v1/tasks/ECOM-1').set(auth(owner.token)).send({ title: null }).expect(400);
  });

  it('moves tasks between columns and keeps positions dense', async () => {
    for (const title of ['Two', 'Three', 'Four']) {
      await http().post('/api/v1/tasks').set(auth(owner.token)).send({ projectId, title }).expect(201);
    }
    await http().patch('/api/v1/tasks/ECOM-3/status').set(auth(rahul.token)).send({ status: 'IN_PROGRESS', position: 0 }).expect(200);
    await http().patch('/api/v1/tasks/ECOM-4/status').set(auth(rahul.token)).send({ status: 'IN_PROGRESS', position: 0 }).expect(200);
    await http().patch('/api/v1/tasks/ECOM-2/status').set(auth(rahul.token)).send({ status: 'TODO', position: 0 }).expect(200);

    const board = (await http().get('/api/v1/projects/ECOM/board').set(auth(owner.token)).expect(200)).body.data;
    const col = (s: string) => board.columns.find((c: any) => c.status === s).tasks.map((t: any) => `${t.key}@${t.position}`);
    expect(col('TODO')).toEqual(['ECOM-2@0', 'ECOM-1@1']);
    expect(col('IN_PROGRESS')).toEqual(['ECOM-4@0', 'ECOM-3@1']);

    const list = await http().get('/api/v1/tasks?projectId=ECOM&status=IN_PROGRESS&size=1').set(auth(owner.token)).expect(200);
    expect(list.body.meta).toEqual({ page: 1, size: 1, total: 2, totalPages: 2 });
  });

  it('enforces RBAC: viewers can read but not write', async () => {
    await http().get('/api/v1/tasks/ECOM-1').set(auth(viewer.token)).expect(200);
    const res = await http().post('/api/v1/tasks').set(auth(viewer.token)).send({ projectId, title: 'Nope' }).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await http().post('/api/v1/organizations/current/members').set(auth(rahul.token)).send({ email: 'x@y.z', role: 'MEMBER' }).expect(403);
  });

  it('isolates tenants', async () => {
    const other = await http()
      .post('/api/v1/auth/register')
      .send({ name: 'Eve', email: 'eve@other.test', password: 'password123', organizationName: 'Other Co' })
      .expect(201);
    await http().get('/api/v1/tasks/ECOM-1').set(auth(other.body.data.token)).expect(404);
    await http().get(`/api/v1/projects/${projectId}`).set(auth(other.body.data.token)).expect(404);
    const list = await http().get('/api/v1/tasks').set(auth(other.body.data.token)).expect(200);
    expect(list.body.data).toEqual([]);
  });

  it('notifies mentioned users and records activity via events', async () => {
    await http().post('/api/v1/tasks/ECOM-1/comments').set(auth(owner.token)).send({ body: 'Can you review this @rahul?' }).expect(201);
    const notifications = await eventually(
      async () => (await http().get('/api/v1/notifications').set(auth(rahul.token))).body,
      (b: any) => b.data.some((n: any) => n.type === 'MENTIONED'),
    );
    expect(notifications.data).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'MENTIONED', taskKey: 'ECOM-1', read: false })]));
    expect(notifications.meta.unreadCount).toBeGreaterThan(0);
    await http().post('/api/v1/notifications/read-all').set(auth(rahul.token)).expect(200);
    expect((await http().get('/api/v1/notifications/unread-count').set(auth(rahul.token))).body.data.count).toBe(0);

    const activity = await eventually(
      async () => (await http().get('/api/v1/tasks/ECOM-1/activity').set(auth(owner.token))).body.data,
      (a: any[]) => a.some((x) => x.type === 'COMMENT_CREATED'),
    );
    expect(activity.map((a: any) => a.summary)).toEqual(expect.arrayContaining(['commented on ECOM-1', 'created ECOM-1 “Implement Payment API”']));
  });

  it('pushes realtime updates to other users watching the project', async () => {
    const socket: Socket = io(baseUrl, { path: '/api/v1/realtime', auth: { token: rahul.token }, transports: ['websocket'] });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('ready', () => resolve());
        socket.once('connect_error', reject);
      });
      const ack = await socket.emitWithAck('subscribe', { projectId });
      expect(ack).toEqual({ ok: true });

      const received = new Promise<any>((resolve) => socket.on('event', (e) => e.type === 'TASK_UPDATED' && resolve(e)));
      await http().patch('/api/v1/tasks/ECOM-1/status').set(auth(owner.token)).send({ status: 'IN_REVIEW', position: 0 }).expect(200);
      const event = await received;
      expect(event).toMatchObject({ type: 'TASK_UPDATED', projectId, actor: { name: 'Alex Morgan' }, data: { task: { key: 'ECOM-1', status: 'IN_REVIEW' } } });
    } finally {
      socket.close();
    }
  });

  it('rejects realtime connections without a valid token', async () => {
    const socket = io(baseUrl, { path: '/api/v1/realtime', auth: { token: 'bad' }, transports: ['websocket'] });
    const reason = await new Promise<string>((resolve) => socket.on('disconnect', (r) => resolve(r)));
    expect(reason).toBe('io server disconnect');
    socket.close();
  });

  it('uploads attachments through signed URLs', async () => {
    const init = await http().post('/api/v1/tasks/ECOM-1/attachments/upload-url').set(auth(owner.token)).send({ fileName: 'spec.txt', contentType: 'text/plain', size: 11 }).expect(201);
    const { uploadUrl, storageKey } = init.body.data;
    await http().put(uploadUrl).set('Content-Type', 'text/plain').send('hello world').expect(200);
    await http().put(uploadUrl.replace(/sig=[^&]+/, 'sig=forged')).send('x').expect(403);

    const done = await http().post('/api/v1/tasks/ECOM-1/attachments').set(auth(owner.token)).send({ storageKey, fileName: 'spec.txt', contentType: 'text/plain' }).expect(201);
    expect(done.body.data).toMatchObject({ fileName: 'spec.txt', size: 11 });
    const file = await http().get(done.body.data.downloadUrl).expect(200);
    expect(file.text ?? file.body.toString()).toBe('hello world');
  });

  it('searches tasks with prefix full-text matching', async () => {
    const res = await http().get('/api/v1/search?q=paym').set(auth(owner.token)).expect(200);
    expect(res.body.data.tasks.map((t: any) => t.key)).toEqual(['ECOM-1']);
    const byKey = await http().get('/api/v1/search?q=ECOM-3').set(auth(owner.token)).expect(200);
    expect(byKey.body.data.tasks[0].key).toBe('ECOM-3');
  });

  it('runs sprints and returns unfinished work to the backlog', async () => {
    const sprint = (await http().get('/api/v1/projects/ECOM/sprints').set(auth(owner.token))).body.data[0];
    await http().patch('/api/v1/tasks/ECOM-1').set(auth(owner.token)).send({ sprintId: sprint.id }).expect(200);
    await http().patch('/api/v1/tasks/ECOM-2').set(auth(owner.token)).send({ sprintId: sprint.id, status: 'DONE' }).expect(200);
    await http().post(`/api/v1/sprints/${sprint.id}/start`).set(auth(owner.token)).expect(201);
    const second = await http().post('/api/v1/projects/ECOM/sprints').set(auth(owner.token)).send({ name: 'Sprint 2' }).expect(201);
    await http().post(`/api/v1/sprints/${second.body.data.id}/start`).set(auth(owner.token)).expect(409);

    const done = await http().post(`/api/v1/sprints/${sprint.id}/complete`).set(auth(owner.token)).expect(201);
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', movedToBacklog: 1 });
    const backlog = await http().get('/api/v1/tasks?projectId=ECOM&sprintId=none').set(auth(owner.token)).expect(200);
    expect(backlog.body.data.map((t: any) => t.key)).toContain('ECOM-1');
  });

  it('serves dashboard and project reports', async () => {
    const dash = await http().get('/api/v1/dashboard').set(auth(owner.token)).expect(200);
    expect(dash.body.data).toEqual(expect.objectContaining({ openTasks: expect.any(Number), activeProjects: 2 }));
    const report = await http().get('/api/v1/projects/ECOM/reports').set(auth(owner.token)).expect(200);
    expect(report.body.data).toMatchObject({ total: 4, completed: 1 });
    expect(report.body.data.trend).toHaveLength(14);
  });
});
