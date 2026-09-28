process.env.DATABASE_URL ??= 'postgres://workora:workora@localhost:5432/workora_test';
process.env.QUEUE_PREFIX = 'workora-test-wf';
process.env.RATE_LIMIT_PER_MINUTE = '100000';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { loadConfig } from '../src/config';
import { nextOccurrence } from '../src/modules/recurrence/recurrence';

jest.setTimeout(60_000);

const eventually = async <T>(fn: () => Promise<T>, check: (v: T) => boolean, timeoutMs = 6000): Promise<T> => {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (check(v) || Date.now() - start > timeoutMs) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
};
const iso = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('recurrence rules (pure)', () => {
  const today = '2026-01-01';
  it.each([
    [{ freq: 'DAILY' }, '2026-01-05', '2026-01-06'],
    [{ freq: 'DAILY', interval: 3 }, '2026-01-05', '2026-01-08'],
    [{ freq: 'WEEKLY' }, '2026-01-05', '2026-01-12'], // Monday → next Monday
    [{ freq: 'WEEKLY', byWeekday: [1, 3, 5] }, '2026-01-05', '2026-01-07'], // Mon → Wed
    [{ freq: 'WEEKLY', byWeekday: [1, 3, 5] }, '2026-01-09', '2026-01-12'], // Fri → Mon
    [{ freq: 'WEEKLY', interval: 2, byWeekday: [1] }, '2026-01-05', '2026-01-19'], // every other Monday
    [{ freq: 'MONTHLY' }, '2026-01-31', '2026-02-28'], // clamps to month end
    [{ freq: 'MONTHLY', interval: 3 }, '2026-01-15', '2026-04-15'],
    [{ freq: 'YEARLY' }, '2028-02-29', '2029-02-28'],
  ] as const)('%j after %s → %s', (rule, base, expected) => {
    expect(nextOccurrence(rule as any, base, today)).toBe(expected);
  });

  it('rolls forward past today when completed late', () => {
    expect(nextOccurrence({ freq: 'WEEKLY' }, '2026-01-05', '2026-02-01')).toBe('2026-02-02');
  });

  it('stops at the end date', () => {
    expect(nextOccurrence({ freq: 'DAILY', endDate: '2026-01-05' }, '2026-01-05', today)).toBeNull();
  });
});

describe('Custom workflows & recurring tasks (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  let token: string;
  let memberToken: string;
  let rahulId: string;
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const get = async (path: string) => (await http().get(`/api/v1${path}`).set(auth()).expect(200)).body.data;
  const task = async (body: Record<string, unknown>) => (await http().post('/api/v1/tasks').set(auth()).send({ projectId: 'OPS', ...body }).expect(201)).body.data;

  beforeAll(async () => {
    const pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    await pg.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await pg.end();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    await configureApp(app, { ...loadConfig(), realtimeRedisAdapter: false });
    await app.init();
    token = (await http().post('/api/v1/auth/register').send({ name: 'Olive Ops', email: 'olive@wf.test', password: 'password123', organizationName: 'WF' }).expect(201)).body.data.token;
    await http().post('/api/v1/organizations/current/members').set(auth()).send({ email: 'rahul@wf.test', name: 'Rahul', role: 'MEMBER', password: 'password123' }).expect(201);
    const r = (await http().post('/api/v1/auth/login').send({ email: 'rahul@wf.test', password: 'password123' }).expect(200)).body.data;
    memberToken = r.token;
    rahulId = r.user.id;
    await http().post('/api/v1/projects').set(auth()).send({ name: 'Operations', key: 'OPS' }).expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('new projects get the default workflow', async () => {
    const states = await get('/projects/OPS/workflow');
    expect(states.map((s: any) => [s.name, s.category])).toEqual([
      ['To do', 'TODO'],
      ['In progress', 'IN_PROGRESS'],
      ['In review', 'IN_REVIEW'],
      ['Done', 'DONE'],
    ]);
  });

  it('admins customise states; members cannot', async () => {
    await http().post('/api/v1/projects/OPS/workflow/states').set(auth(memberToken)).send({ name: 'QA', category: 'IN_REVIEW' }).expect(403);
    let states = (await http().post('/api/v1/projects/OPS/workflow/states').set(auth()).send({ name: 'QA', category: 'IN_REVIEW', position: 3, wipLimit: 2 }).expect(201)).body.data;
    expect(states.map((s: any) => s.name)).toEqual(['To do', 'In progress', 'In review', 'QA', 'Done']);
    await http().post('/api/v1/projects/OPS/workflow/states').set(auth()).send({ name: 'qa', category: 'TODO' }).expect(409);
    states = (await http().post('/api/v1/projects/OPS/workflow/states').set(auth()).send({ name: 'Triage', category: 'TODO', position: 0 }).expect(201)).body.data;
    expect(states[0]).toMatchObject({ name: 'Triage', position: 0 });
  });

  it('tasks land in the default state and move between custom states', async () => {
    const states = await get('/projects/OPS/workflow');
    const qa = states.find((s: any) => s.name === 'QA');
    const t = await task({ title: 'Rotate TLS certificates' });
    expect(t.state.name).toBe('Triage'); // first "to do" state by position
    const moved = await http().patch(`/api/v1/tasks/${t.key}/status`).set(auth()).send({ stateId: qa.id, position: 0 }).expect(200);
    expect(moved.body.data).toMatchObject({ status: 'IN_REVIEW', state: { name: 'QA' } });
    const board = await get('/projects/OPS/board');
    expect(board.columns.map((c: any) => c.state.name)).toEqual(['Triage', 'To do', 'In progress', 'In review', 'QA', 'Done']);
    expect(board.columns.find((c: any) => c.state.name === 'QA').tasks.map((x: any) => x.key)).toEqual([t.key]);
    const activity = await eventually(() => get(`/tasks/${t.key}/activity`), (a: any[]) => a.some((x) => x.summary.includes('to QA')));
    expect(activity.some((x: any) => x.summary.includes(`moved ${t.key} from`) && x.summary.includes('to QA'))).toBe(true);
    // status-only update picks the first state of that category
    const done = await http().patch(`/api/v1/tasks/${t.key}`).set(auth()).send({ status: 'DONE' }).expect(200);
    expect(done.body.data).toMatchObject({ status: 'DONE', state: { name: 'Done' } });
    expect(done.body.data.completedAt).toBeTruthy();
    const filtered = await get(`/tasks?projectId=OPS&stateId=${qa.id}`);
    expect(filtered).toEqual([]);
  });

  it('changing a state category re-syncs its tasks', async () => {
    const states = await get('/projects/OPS/workflow');
    const qa = states.find((s: any) => s.name === 'QA');
    const t = await task({ title: 'Load test checkout', stateId: qa.id });
    expect(t.status).toBe('IN_REVIEW');
    await http().patch(`/api/v1/workflow-states/${qa.id}`).set(auth()).send({ category: 'DONE', name: 'Verified' }).expect(200);
    const after = await get(`/tasks/${t.key}`);
    expect(after).toMatchObject({ status: 'DONE', state: { name: 'Verified' } });
    expect(after.completedAt).toBeTruthy();
  });

  it('reorders and deletes states (moving their tasks)', async () => {
    let states = await get('/projects/OPS/workflow');
    const reversed = [...states].reverse().map((s: any) => s.id);
    states = (await http().patch('/api/v1/projects/OPS/workflow/order').set(auth()).send({ stateIds: reversed }).expect(200)).body.data;
    expect(states[0].name).toBe('Done');
    await http().patch('/api/v1/projects/OPS/workflow/order').set(auth()).send({ stateIds: reversed.slice(1) }).expect(400);

    const triage = states.find((s: any) => s.name === 'Triage');
    const todo = states.find((s: any) => s.name === 'To do');
    await task({ title: 'Stray bug', stateId: triage.id });
    const refused = await http().delete(`/api/v1/workflow-states/${triage.id}`).set(auth()).expect(400);
    expect(refused.body.error).toMatchObject({ code: 'STATE_NOT_EMPTY', details: { taskCount: expect.any(Number) } });
    states = (await http().delete(`/api/v1/workflow-states/${triage.id}?moveTo=${todo.id}`).set(auth()).expect(200)).body.data;
    expect(states.some((s: any) => s.name === 'Triage')).toBe(false);
    expect(states.find((s: any) => s.name === 'To do').taskCount).toBeGreaterThanOrEqual(1);
    expect(states.map((s: any) => s.position)).toEqual(states.map((_: any, i: number) => i));
  });

  it('automations can move tasks into a state and trigger on entering one', async () => {
    const states = await get('/projects/OPS/workflow');
    const review = states.find((s: any) => s.name === 'In review');
    const verified = states.find((s: any) => s.name === 'Verified');
    await http()
      .post('/api/v1/projects/OPS/automations')
      .set(auth())
      .send({ name: 'Review → Verified', trigger: { event: 'STATE_CHANGED', to: review.id }, actions: [{ type: 'SET_STATE', stateId: verified.id }] })
      .expect(201);
    const t = await task({ title: 'Update runbook' });
    await http().patch(`/api/v1/tasks/${t.key}/status`).set(auth()).send({ stateId: review.id, position: 0 }).expect(200);
    const after = await eventually(() => get(`/tasks/${t.key}`), (x: any) => x.state.name === 'Verified');
    expect(after).toMatchObject({ state: { name: 'Verified' }, status: 'DONE' });
  });

  it('recurring tasks spawn their next occurrence on completion, once', async () => {
    const label = (await http().post('/api/v1/labels').set(auth()).send({ name: 'Ops' }).expect(201)).body.data;
    const t = await task({
      title: 'Weekly backup restore drill',
      dueDate: iso(1),
      startDate: iso(0),
      assigneeId: rahulId,
      labelIds: [label.id],
      estimateMinutes: 45,
      recurrence: { freq: 'WEEKLY' },
    });
    expect(t.recurrence).toEqual({ freq: 'WEEKLY' });
    await http().patch(`/api/v1/tasks/${t.key}`).set(auth()).send({ status: 'DONE' }).expect(200);

    const list = await eventually(
      () => get('/tasks?projectId=OPS&q=backup restore&size=50'),
      (l: any[]) => l.length === 2,
    );
    const next = list.find((x: any) => x.id !== t.id);
    expect(next).toMatchObject({
      dueDate: iso(8),
      startDate: iso(7),
      status: 'TODO',
      assignee: { id: rahulId },
      estimateMinutes: 45,
      recurrence: { freq: 'WEEKLY' },
      labels: [expect.objectContaining({ name: 'Ops' })],
    });
    expect(next.seriesId).toBe(t.id);

    // Reopening and completing again must not create a duplicate.
    await http().patch(`/api/v1/tasks/${t.key}`).set(auth()).send({ status: 'TODO' }).expect(200);
    await http().patch(`/api/v1/tasks/${t.key}`).set(auth()).send({ status: 'DONE' }).expect(200);
    await new Promise((r) => setTimeout(r, 600));
    expect(await get('/tasks?projectId=OPS&q=backup restore&size=50')).toHaveLength(2);

    const activity = await eventually(() => get(`/tasks/${next.key}/activity`), (a: any[]) => a.some((x) => x.type === 'TASK_RECURRED'));
    expect(activity.find((x: any) => x.type === 'TASK_RECURRED').summary).toContain(`next occurrence ${next.key}`);
  });

  it('ended series and cleared recurrence stop spawning; invalid rules are rejected', async () => {
    const ended = await task({ title: 'One last time', dueDate: iso(0), recurrence: { freq: 'DAILY', endDate: iso(0) } });
    await http().patch(`/api/v1/tasks/${ended.key}`).set(auth()).send({ status: 'DONE' }).expect(200);
    const cleared = await task({ title: 'Stop repeating me', recurrence: { freq: 'DAILY' } });
    await http().patch(`/api/v1/tasks/${cleared.key}`).set(auth()).send({ recurrence: null }).expect(200);
    await http().patch(`/api/v1/tasks/${cleared.key}`).set(auth()).send({ status: 'DONE' }).expect(200);
    await new Promise((r) => setTimeout(r, 600));
    expect(await get('/tasks?projectId=OPS&q=One last time')).toHaveLength(1);
    expect(await get('/tasks?projectId=OPS&q=Stop repeating')).toHaveLength(1);
    const bad = await http().post('/api/v1/tasks').set(auth()).send({ projectId: 'OPS', title: 'x', recurrence: { freq: 'HOURLY' } }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});
