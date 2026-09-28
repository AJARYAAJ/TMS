process.env.DATABASE_URL ??= 'postgres://workora:workora@localhost:5432/workora_test';
process.env.QUEUE_PREFIX = 'workora-test-features';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.STORAGE_ROOT = `${__dirname}/../data/test-uploads`;

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
import { JobsProcessor } from '../src/modules/jobs/jobs.module';

jest.setTimeout(60_000);

const eventually = async <T>(fn: () => Promise<T>, check: (v: T) => boolean, timeoutMs = 6000): Promise<T> => {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (check(v) || Date.now() - start > timeoutMs) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
};

describe('Workora work-management features (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  let owner: { token: string; userId: string };
  let rahul: { token: string; userId: string };
  let projectId: string;

  const task = async (title: string, extra: Record<string, unknown> = {}, token = owner.token) =>
    (await http().post('/api/v1/tasks').set(auth(token)).send({ projectId: 'WEB', title, ...extra }).expect(201)).body.data;
  const get = async (path: string, token = owner.token) => (await http().get(`/api/v1${path}`).set(auth(token)).expect(200)).body.data;

  beforeAll(async () => {
    const pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    await pg.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await pg.end();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    await configureApp(app, { ...loadConfig(), realtimeRedisAdapter: false });
    await app.init();

    const reg = await http().post('/api/v1/auth/register').send({ name: 'Alex Morgan', email: 'alex@f.test', password: 'password123', organizationName: 'Features' }).expect(201);
    owner = { token: reg.body.data.token, userId: reg.body.data.user.id };
    await http().post('/api/v1/organizations/current/members').set(auth(owner.token)).send({ email: 'rahul@f.test', name: 'Rahul Sharma', role: 'MEMBER', password: 'password123' }).expect(201);
    const r = (await http().post('/api/v1/auth/login').send({ email: 'rahul@f.test', password: 'password123' }).expect(200)).body.data;
    rahul = { token: r.token, userId: r.user.id };
    projectId = (await http().post('/api/v1/projects').set(auth(owner.token)).send({ name: 'Website', key: 'WEB' }).expect(201)).body.data.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('labels: create, apply, filter, reject duplicates', async () => {
    const bug = (await http().post('/api/v1/labels').set(auth(owner.token)).send({ name: 'Frontend', color: '#0ea5e9' }).expect(201)).body.data;
    await http().post('/api/v1/labels').set(auth(owner.token)).send({ name: 'frontend' }).expect(409);
    const t = await task('Hero banner', { labelIds: [bug.id] });
    expect(t.labels).toEqual([{ id: bug.id, name: 'Frontend', color: '#0ea5e9' }]);
    await task('Unlabelled');
    const filtered = await http().get(`/api/v1/tasks?projectId=WEB&labelId=${bug.id}`).set(auth(owner.token)).expect(200);
    expect(filtered.body.data.map((x: any) => x.key)).toEqual([t.key]);
    const cleared = await http().patch(`/api/v1/tasks/${t.key}`).set(auth(owner.token)).send({ labelIds: [] }).expect(200);
    expect(cleared.body.data.labels).toEqual([]);
    expect((await get('/labels'))[0]).toMatchObject({ name: 'Frontend', usage: 0 });
  });

  it('epics & subtasks: progress roll-up, no cycles, roadmap', async () => {
    const epic = await task('Launch v2', { type: 'EPIC', startDate: '2026-10-01', dueDate: '2026-11-15' });
    const a = await task('Design system', { parentId: epic.id });
    const b = await task('Pricing page', { parentId: epic.id, status: 'DONE' });
    expect(a.parent).toMatchObject({ key: epic.key, type: 'EPIC' });
    const detail = await get(`/tasks/${epic.key}`);
    expect(detail).toMatchObject({ subtaskCount: 2, subtaskDone: 1 });
    expect((await get(`/tasks/${epic.key}/subtasks`)).map((x: any) => x.key)).toEqual([a.key, b.key]);
    const cycle = await http().patch(`/api/v1/tasks/${epic.key}`).set(auth(owner.token)).send({ parentId: a.id }).expect(400);
    expect(cycle.body.error.code).toBe('INVALID_PARENT');
    const roadmap = await get('/roadmap?projectId=WEB');
    expect(roadmap).toEqual([expect.objectContaining({ key: epic.key, childCount: 2, childDone: 1, progress: 50, startDate: '2026-10-01', dueDate: '2026-11-15' })]);
    expect((await get('/tasks?projectId=WEB&parentId=none&size=100')).every((x: any) => !x.parentId)).toBe(true);
  });

  it('dependencies: blocked-by counts and cycle prevention', async () => {
    const api = await task('Build API');
    const ui = await task('Build UI');
    await http().post(`/api/v1/tasks/${ui.key}/links`).set(auth(owner.token)).send({ targetId: api.key, type: 'BLOCKS', direction: 'incoming' }).expect(201);
    expect((await get(`/tasks/${ui.key}`)).blockedBy).toBe(1);
    const links = await get(`/tasks/${ui.key}/links`);
    expect(links).toEqual([expect.objectContaining({ relation: 'blocked by', task: expect.objectContaining({ key: api.key }) })]);
    const cycle = await http().post(`/api/v1/tasks/${ui.key}/links`).set(auth(owner.token)).send({ targetId: api.key, type: 'BLOCKS' }).expect(400);
    expect(cycle.body.error.code).toBe('DEPENDENCY_CYCLE');
    await http().patch(`/api/v1/tasks/${api.key}`).set(auth(owner.token)).send({ status: 'DONE' }).expect(200);
    expect((await get(`/tasks/${ui.key}`)).blockedBy).toBe(0);
    await http().delete(`/api/v1/tasks/${ui.key}/links/${links[0].id}`).set(auth(owner.token)).expect(200);
    expect(await get(`/tasks/${ui.key}/links`)).toEqual([]);
  });

  it('watchers get notified about comments and status changes', async () => {
    const t = await task('Copy review');
    expect((await get(`/tasks/${t.key}`)).watchers.map((w: any) => w.id)).toEqual([owner.userId]);
    await http().post(`/api/v1/tasks/${t.key}/watchers`).set(auth(rahul.token)).send({}).expect(201);
    await http().post(`/api/v1/tasks/${t.key}/comments`).set(auth(owner.token)).send({ body: 'First draft is up' }).expect(201);
    await http().patch(`/api/v1/tasks/${t.key}`).set(auth(owner.token)).send({ status: 'IN_REVIEW' }).expect(200);
    const notes = await eventually(
      async () => (await get('/notifications', rahul.token)) as any[],
      (n) => n.some((x) => x.type === 'COMMENT_CREATED' && x.taskKey === t.key) && n.some((x) => x.type === 'TASK_STATUS_CHANGED' && x.taskKey === t.key),
    );
    expect(notes.filter((x) => x.taskKey === t.key).map((x) => x.type).sort()).toEqual(['COMMENT_CREATED', 'TASK_STATUS_CHANGED']);
    await http().delete(`/api/v1/tasks/${t.key}/watchers/${rahul.userId}`).set(auth(rahul.token)).expect(200);
  });

  it('time tracking: one running timer, manual logs, timesheet', async () => {
    const t1 = await task('Write tests', { estimateMinutes: 120 });
    const t2 = await task('Fix CI');
    const timer = await http().post(`/api/v1/tasks/${t1.key}/timer`).set(auth(owner.token)).send({}).expect(201);
    expect(timer.body.data).toMatchObject({ running: true, task: { key: t1.key } });
    await http().post(`/api/v1/tasks/${t2.key}/timer`).set(auth(owner.token)).send({}).expect(201); // switches task
    expect((await get('/timer')).task.key).toBe(t2.key);
    const stopped = await http().post('/api/v1/timer/stop').set(auth(owner.token)).expect(200);
    expect(stopped.body.data).toMatchObject({ running: false, minutes: 1 });
    await http().post('/api/v1/timer/stop').set(auth(owner.token)).expect(400);
    await http().post(`/api/v1/tasks/${t1.key}/time-entries`).set(auth(owner.token)).send({ minutes: 90, note: 'pairing' }).expect(201);
    expect(await get('/timer')).toBeNull();
    expect((await get(`/tasks/${t1.key}`)).loggedMinutes).toBe(91);
    const sheet = await get('/time-entries?userId=me');
    expect(sheet.totalMinutes).toBe(92);
    expect(sheet.entries).toHaveLength(3);
    await http().get(`/api/v1/time-entries?userId=${owner.userId}`).set(auth(rahul.token)).expect(403);
  });

  it('goals: key results (manual + task-based) and linked tasks', async () => {
    const goal = (await http().post('/api/v1/goals').set(auth(owner.token)).send({ title: 'Grow signups', projectId: 'WEB', dueDate: '2026-12-31' }).expect(201)).body.data;
    let g = (await http().post(`/api/v1/goals/${goal.id}/key-results`).set(auth(owner.token)).send({ title: 'Weekly signups', startValue: 100, targetValue: 300, currentValue: 200 }).expect(201)).body.data;
    expect(g.keyResults[0].progress).toBe(50);
    g = (await http().post(`/api/v1/goals/${goal.id}/key-results`).set(auth(owner.token)).send({ title: 'Ship launch tasks', kind: 'TASKS' }).expect(201)).body.data;
    const done = await task('Launch email', { status: 'DONE' });
    const open = await task('Launch blog post');
    await http().post(`/api/v1/goals/${goal.id}/tasks`).set(auth(owner.token)).send({ taskId: done.key }).expect(201);
    g = (await http().post(`/api/v1/goals/${goal.id}/tasks`).set(auth(owner.token)).send({ taskId: open.key }).expect(201)).body.data;
    expect(g.keyResults[1]).toMatchObject({ kind: 'TASKS', currentValue: 1, targetValue: 2, progress: 50 });
    expect(g.progress).toBe(50);
    const kr = g.keyResults[0];
    g = (await http().patch(`/api/v1/goals/${goal.id}/key-results/${kr.id}`).set(auth(owner.token)).send({ currentValue: 300 }).expect(200)).body.data;
    expect(g.progress).toBe(75);
    g = (await http().patch(`/api/v1/goals/${goal.id}`).set(auth(owner.token)).send({ status: 'AT_RISK' }).expect(200)).body.data;
    expect(g).toMatchObject({ status: 'AT_RISK', project: { key: 'WEB' }, taskCount: 2 });
    expect((await get('/goals?projectId=WEB')).length).toBe(1);
  });

  it('documents: markdown pages with version conflict detection and search', async () => {
    const doc = (await http().post('/api/v1/documents').set(auth(owner.token)).send({ title: 'Launch plan', projectId: 'WEB', content: '# Launch\n\nThe **zeppelin** checklist' }).expect(201)).body.data;
    expect(doc).toMatchObject({ version: 1, projectId, icon: '📄' });
    const saved = await http().patch(`/api/v1/documents/${doc.id}`).set(auth(rahul.token)).send({ content: '# Launch\n\nUpdated', version: 1 }).expect(200);
    expect(saved.body.data).toMatchObject({ version: 2, updatedBy: { name: 'Rahul Sharma' } });
    const conflict = await http().patch(`/api/v1/documents/${doc.id}`).set(auth(owner.token)).send({ title: 'Stale', version: 1 }).expect(409);
    expect(conflict.body.error).toMatchObject({ code: 'DOCUMENT_CONFLICT', details: { currentVersion: 2 } });
    expect((await get('/documents?projectId=WEB')).map((d: any) => d.title)).toEqual(['Launch plan']);
    expect((await get('/search?q=launch')).documents.map((d: any) => d.id)).toContain(doc.id);
    await http().delete(`/api/v1/documents/${doc.id}`).set(auth(rahul.token)).expect(403);
    await http().delete(`/api/v1/documents/${doc.id}`).set(auth(owner.token)).expect(200);
  });

  it('automations: rules react to events and never loop', async () => {
    await http().post('/api/v1/projects/WEB/automations').set(auth(rahul.token)).send({ name: 'x', trigger: { event: 'TASK_CREATED' }, actions: [{ type: 'UNASSIGN' }] }).expect(403);
    const bad = await http().post('/api/v1/projects/WEB/automations').set(auth(owner.token)).send({ name: 'bad', trigger: { event: 'NOPE' }, actions: [] }).expect(400);
    expect(bad.body.error.code).toBe('INVALID_AUTOMATION');

    await http()
      .post('/api/v1/projects/WEB/automations')
      .set(auth(owner.token))
      .send({ name: 'Urgent to Rahul', trigger: { event: 'PRIORITY_CHANGED', to: 'URGENT' }, actions: [{ type: 'ASSIGN', userId: rahul.userId }, { type: 'NOTIFY', target: 'ASSIGNEE', message: '{task.key} is urgent' }] })
      .expect(201);
    const done = (
      await http()
        .post('/api/v1/projects/WEB/automations')
        .set(auth(owner.token))
        .send({ name: 'Close out', trigger: { event: 'STATUS_CHANGED', to: 'DONE' }, actions: [{ type: 'ADD_COMMENT', body: 'Closed automatically ✅' }, { type: 'SET_PRIORITY', priority: 'LOW' }] })
        .expect(201)
    ).body.data;

    const t = await task('Checkout crash');
    await http().patch(`/api/v1/tasks/${t.key}`).set(auth(owner.token)).send({ priority: 'URGENT' }).expect(200);
    const assigned = await eventually(() => get(`/tasks/${t.key}`), (x: any) => x.assignee?.id === rahul.userId);
    expect(assigned.assignee.name).toBe('Rahul Sharma');
    const notes = await eventually(async () => (await get('/notifications', rahul.token)) as any[], (n) => n.some((x) => x.type === 'AUTOMATION'));
    expect(notes.find((x) => x.type === 'AUTOMATION').title).toBe(`${t.key} is urgent`);

    // SET_PRIORITY LOW (from rule) must not re-trigger the URGENT rule or itself.
    await http().patch(`/api/v1/tasks/${t.key}`).set(auth(owner.token)).send({ status: 'DONE' }).expect(200);
    const closed = await eventually(() => get(`/tasks/${t.key}`), (x: any) => x.priority === 'LOW' && x.commentCount === 1);
    expect(closed).toMatchObject({ priority: 'LOW', commentCount: 1, status: 'DONE' });
    await new Promise((r) => setTimeout(r, 500));
    const rules = await get('/projects/WEB/automations');
    expect(rules.find((r: any) => r.id === done.id).runCount).toBe(1);
    const activity = await get(`/tasks/${t.key}/activity`);
    expect(activity.some((a: any) => a.actor.name === '⚡ Close out')).toBe(true);
  });

  it('webhooks: signed deliveries with a delivery log', async () => {
    const received: { headers: any; body: string }[] = [];
    const server: Server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.writeHead(200).end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
      await http().post('/api/v1/integrations/webhooks').set(auth(rahul.token)).send({ name: 'x', url }).expect(403);
      const hook = (await http().post('/api/v1/integrations/webhooks').set(auth(owner.token)).send({ name: 'CI', url, events: ['TASK_CREATED'] }).expect(201)).body.data;
      expect(hook.secret).toMatch(/^whsec_/);
      expect((await get('/integrations/webhooks'))[0].secret).toBeUndefined();

      await task('Webhook me');
      await task('Ignored comment target');
      const got = await eventually(async () => received, (r) => r.length >= 2);
      const created = got.filter((r) => r.headers['x-workora-event'] === 'TASK_CREATED');
      expect(created.length).toBe(2);
      const sig = `sha256=${createHmac('sha256', hook.secret).update(created[0].body).digest('hex')}`;
      expect(created[0].headers['x-workora-signature']).toBe(sig);
      expect(JSON.parse(created[0].body)).toMatchObject({ type: 'TASK_CREATED', data: { task: { title: 'Webhook me' } } });

      await http().post(`/api/v1/integrations/webhooks/${hook.id}/test`).set(auth(owner.token)).expect(201);
      await eventually(async () => received, (r) => r.some((x) => x.headers['x-workora-event'] === 'PING'));
      const deliveries = await eventually(() => get(`/integrations/webhooks/${hook.id}/deliveries`), (d: any[]) => d.length >= 3);
      expect(deliveries.every((d: any) => d.success && d.statusCode === 200)).toBe(true);
    } finally {
      server.close();
    }
  });

  it('bulk edit, favorites and overdue reminders', async () => {
    const a = await task('Bulk A');
    const b = await task('Bulk B', { assigneeId: rahul.userId, dueDate: '2020-01-01' });
    const bulk = await http().patch('/api/v1/tasks/bulk').set(auth(owner.token)).send({ ids: [a.key, b.id, 'WEB-9999'], patch: { priority: 'HIGH', status: 'IN_PROGRESS' } }).expect(200);
    expect(bulk.body.data.updated.map((t: any) => t.priority)).toEqual(['HIGH', 'HIGH']);
    expect(bulk.body.data.failed).toEqual([expect.objectContaining({ id: 'WEB-9999', code: 'TASK_NOT_FOUND' })]);

    await http().post('/api/v1/projects/WEB/favorite').set(auth(owner.token)).expect(201);
    expect((await get('/projects')).find((p: any) => p.key === 'WEB').isFavorite).toBe(true);
    expect((await get('/projects', rahul.token)).find((p: any) => p.key === 'WEB').isFavorite).toBe(false);
    expect((await get('/favorites')).map((p: any) => p.key)).toEqual(['WEB']);

    const scan = await app.get(JobsProcessor).scanOverdue();
    expect(scan.overdue).toBeGreaterThanOrEqual(1);
    expect((await app.get(JobsProcessor).scanOverdue()).overdue).toBe(0); // only once per task
    const notes = await eventually(async () => (await get('/notifications', rahul.token)) as any[], (n) => n.some((x) => x.type === 'TASK_OVERDUE'));
    expect(notes.find((x) => x.type === 'TASK_OVERDUE').taskKey).toBe(b.key);
  });

  it('reports include time and the dashboard heatmap', async () => {
    const report = await get('/projects/WEB/reports');
    expect(report.loggedMinutes).toBe(92);
    expect(report.estimateMinutes).toBe(120);
    expect(report.timeByUser[0]).toMatchObject({ name: 'Alex Morgan', minutes: 92 });
    const dash = await get('/dashboard');
    expect(dash).toEqual(expect.objectContaining({ minutesThisWeek: expect.any(Number), heatmap: expect.any(Array) }));
  });
});
