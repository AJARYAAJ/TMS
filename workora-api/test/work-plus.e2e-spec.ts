process.env.DATABASE_URL ??= 'postgres://workora:workora@localhost:5432/workora_test';
process.env.QUEUE_PREFIX = 'workora-test-plus';
process.env.RATE_LIMIT_PER_MINUTE = '100000';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { loadConfig } from '../src/config';
import { parseCsv, parseDate, toCsv } from '../src/modules/csv/csv';
import { allocate } from '../src/modules/insights/insights.module';

jest.setTimeout(60_000);

const iso = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('pure helpers', () => {
  it('parses CSV with quotes, escaped quotes, embedded newlines, BOM and ; delimiters', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\n\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"\nthere'],
    ]);
    expect(parseCsv('Name;Due\nFoo;2026-01-02')).toEqual([
      ['Name', 'Due'],
      ['Foo', '2026-01-02'],
    ]);
  });

  it('writes Excel-safe CSV and neutralises formulas', () => {
    const out = toCsv(['A', 'B'], [['=HYPERLINK("x")', 'plain, "quoted"']]);
    expect(out).toBe('﻿A,B\r\n"\'=HYPERLINK(""x"")","plain, ""quoted"""\r\n');
  });

  it('parses dates from common export formats', () => {
    expect(parseDate('2026-09-28T10:00:00Z')).toBe('2026-09-28');
    expect(parseDate('28/Sep/26 3:15 PM')).toBe('2026-09-28');
    expect(parseDate('9/28/2026')).toBe('2026-09-28');
    expect(parseDate('28.09.2026')).toBe('2026-09-28');
    expect(parseDate('soon')).toBeNull();
  });

  it('spreads estimates over working days and carries overdue work into the first week', () => {
    // Mon 2026-10-05 … Fri 2026-10-09: 10h over 5 days, all in week 0.
    expect(allocate({ estimateMinutes: 600, startDate: '2026-10-05', dueDate: '2026-10-09' }, '2026-10-05', 2)).toEqual([600, 0]);
    // Thu → next Wed spans two weeks: 2 days + 3 days.
    expect(allocate({ estimateMinutes: 500, startDate: '2026-10-08', dueDate: '2026-10-14' }, '2026-10-05', 2)).toEqual([200, 300]);
    // Overdue: due before the window → first week.
    expect(allocate({ estimateMinutes: 120, startDate: null, dueDate: '2026-09-01' }, '2026-10-05', 3)).toEqual([120, 0, 0]);
    expect(allocate({ estimateMinutes: 120, startDate: null, dueDate: null }, '2026-10-05', 3)).toBeNull();
  });
});

describe('Custom fields, trash, views, insights, forms, CSV (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  let owner: string;
  let member: string;
  let viewer: string;
  let memberId: string;
  let ownerId: string;
  const auth = (t = owner) => ({ Authorization: `Bearer ${t}` });
  const get = async (path: string, t = owner) => (await http().get(`/api/v1${path}`).set(auth(t)).expect(200)).body.data;
  const post = async (path: string, body: unknown, t = owner, status = 201) => (await http().post(`/api/v1${path}`).set(auth(t)).send(body as object).expect(status)).body.data;
  const patch = async (path: string, body: unknown, t = owner, status = 200) => (await http().patch(`/api/v1${path}`).set(auth(t)).send(body as object).expect(status)).body.data;
  const task = (title: string, extra: Record<string, unknown> = {}, t = owner) => post('/tasks', { projectId: 'OPS', title, ...extra }, t);

  beforeAll(async () => {
    const pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    await pg.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await pg.end();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    await configureApp(app, { ...loadConfig(), realtimeRedisAdapter: false });
    await app.init();
    owner = (await http().post('/api/v1/auth/register').send({ name: 'Olive Owner', email: 'olive@plus.test', password: 'password123', organizationName: 'Plus' }).expect(201)).body.data.token;
    await post('/organizations/current/members', { email: 'mo@plus.test', name: 'Mo Member', role: 'MEMBER', password: 'password123' });
    await post('/organizations/current/members', { email: 'vi@plus.test', name: 'Vi Viewer', role: 'VIEWER', password: 'password123' });
    member = (await http().post('/api/v1/auth/login').send({ email: 'mo@plus.test', password: 'password123' }).expect(200)).body.data.token;
    viewer = (await http().post('/api/v1/auth/login').send({ email: 'vi@plus.test', password: 'password123' }).expect(200)).body.data.token;
    const users = await get('/users');
    memberId = users.find((x: any) => x.email === 'mo@plus.test').id;
    ownerId = users.find((x: any) => x.email === 'olive@plus.test').id;
    await post('/projects', { name: 'Ops', key: 'OPS' });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('custom fields', () => {
    let fields: any[];
    const f = (name: string) => fields.find((x) => x.name === name);

    it('creates typed fields; members only; names unique', async () => {
      await post('/projects/OPS/fields', { name: 'Tier', type: 'SELECT', options: [{ label: 'Gold' }] }, viewer, 403);
      await post('/projects/OPS/fields', { name: 'Tier', type: 'SELECT' }, owner, 400);
      await post('/projects/OPS/fields', { name: 'Tier', type: 'SELECT', options: [{ label: 'Gold' }, { label: 'Silver' }, { label: 'Bronze' }] });
      await post('/projects/OPS/fields', { name: 'Platforms', type: 'MULTI_SELECT', options: [{ label: 'iOS' }, { label: 'Android' }, { label: 'Web' }] });
      await post('/projects/OPS/fields', { name: 'Revenue', type: 'NUMBER' });
      await post('/projects/OPS/fields', { name: 'Customer', type: 'TEXT', required: true });
      await post('/projects/OPS/fields', { name: 'Signed', type: 'CHECKBOX' });
      await post('/projects/OPS/fields', { name: 'Go-live', type: 'DATE' });
      await post('/projects/OPS/fields', { name: 'Spec', type: 'URL' });
      fields = await post('/projects/OPS/fields', { name: 'Reviewer', type: 'PERSON' });
      await post('/projects/OPS/fields', { name: 'tier', type: 'TEXT' }, owner, 409);
      expect(fields.map((x) => x.name)).toEqual(['Tier', 'Platforms', 'Revenue', 'Customer', 'Signed', 'Go-live', 'Spec', 'Reviewer']);
      expect(f('Tier').options.map((o: any) => o.label)).toEqual(['Gold', 'Silver', 'Bronze']);
    });

    it('stores values by field id or name, accepting option labels, and validates them', async () => {
      const t = await task('Acme rollout', {
        customFields: { [f('Tier').id]: 'gold', Platforms: 'iOS; Web', Revenue: '12,500', Customer: 'Acme', Signed: 'yes', 'Go-live': '2026-11-01', Spec: 'https://acme.test/spec', Reviewer: memberId },
      });
      expect(t.customFields).toEqual({
        [f('Tier').id]: f('Tier').options[0].id,
        [f('Platforms').id]: [f('Platforms').options[0].id, f('Platforms').options[2].id],
        [f('Revenue').id]: 12500,
        [f('Customer').id]: 'Acme',
        [f('Signed').id]: true,
        [f('Go-live').id]: '2026-11-01',
        [f('Spec').id]: 'https://acme.test/spec',
        [f('Reviewer').id]: memberId,
      });
      for (const bad of [{ Tier: 'Platinum' }, { Revenue: 'lots' }, { 'Go-live': 'tomorrow' }, { Spec: 'javascript:alert(1)' }, { Reviewer: '00000000-0000-4000-8000-000000000000' }, { Nope: 1 }]) {
        await http().post('/api/v1/tasks').set(auth()).send({ projectId: 'OPS', title: 'bad', customFields: bad }).expect(400);
      }
      const updated = await patch(`/tasks/${t.key}`, { customFields: { Tier: 'Silver', Signed: null } });
      expect(updated.customFields[f('Tier').id]).toBe(f('Tier').options[1].id);
      expect(updated.customFields[f('Signed').id]).toBeUndefined();
      const activity = await get(`/tasks/${t.key}/activity`);
      expect(activity[0].summary).toBe(`updated Tier, Signed on ${t.key}`);
    });

    it('filters the list by custom field values', async () => {
      await task('Beta rollout', { customFields: { Tier: 'Bronze', Platforms: ['Android'], Signed: true } });
      await task('No fields');
      const list = async (cf: object) => (await get(`/tasks?projectId=OPS&cf=${encodeURIComponent(JSON.stringify(cf))}`)).map((x: any) => x.title).sort();
      expect(await list({ [f('Tier').id]: f('Tier').options[2].id })).toEqual(['Beta rollout']);
      expect(await list({ [f('Platforms').id]: f('Platforms').options[2].id })).toEqual(['Acme rollout']);
      expect(await list({ [f('Signed').id]: false })).toEqual(['Acme rollout', 'No fields']);
      expect(await list({ [f('Tier').id]: null })).toEqual(['No fields']);
      await http().get('/api/v1/tasks?cf=notjson').set(auth()).expect(400);
    });

    it('keeps values when options are renamed and prunes removed options; deleting a field clears values', async () => {
      const tier = f('Tier');
      const [gold, silver] = tier.options;
      fields = await patch(`/fields/${tier.id}`, { options: [{ id: gold.id, label: 'Gold+' }, { id: silver.id, label: 'Silver' }] });
      const acme = (await get('/tasks?projectId=OPS&q=Acme'))[0];
      const beta = (await get('/tasks?projectId=OPS&q=Beta'))[0];
      expect(acme.customFields[tier.id]).toBe(silver.id);
      expect(beta.customFields[tier.id]).toBeUndefined(); // Bronze was removed
      fields = await http().delete(`/api/v1/fields/${f('Revenue').id}`).set(auth()).expect(200).then((r) => r.body.data);
      expect((await get(`/tasks/${acme.key}`)).customFields[Object.keys(acme.customFields).find((k) => !fields.some((x: any) => x.id === k))!]).toBeUndefined();
      expect(fields.some((x: any) => x.name === 'Revenue')).toBe(false);
    });
  });

  describe('trash', () => {
    it('trashes a task with its subtasks; everything that lists tasks skips them; restore brings all back', async () => {
      const parent = await task('Migrate billing', { storyPoints: 5 });
      const child = await task('Export invoices', { parentId: parent.id });
      await post(`/tasks/${parent.key}/comments`, { body: 'Keep this comment' });
      const blocker = await task('Blocked thing');
      await post(`/tasks/${blocker.key}/links`, { targetId: parent.key, type: 'BLOCKS', direction: 'incoming' });
      const before = await get('/projects/OPS/reports');

      const del = (await http().delete(`/api/v1/tasks/${parent.key}`).set(auth()).expect(200)).body.data;
      expect(del).toMatchObject({ trashed: true, count: 2 });
      await http().get(`/api/v1/tasks/${child.key}`).set(auth()).expect(404);
      expect((await get('/tasks?projectId=OPS')).some((x: any) => [parent.key, child.key].includes(x.key))).toBe(false);
      const board = await get('/projects/OPS/board');
      expect(board.columns.flatMap((c: any) => c.tasks).some((x: any) => x.key === parent.key)).toBe(false);
      expect((await get('/search?q=Migrate')).tasks).toHaveLength(0);
      expect((await get('/projects/OPS/reports')).total).toBe(before.total - 2);
      expect((await get(`/tasks/${blocker.key}/links`))).toHaveLength(0);

      const trash = await get('/trash?projectId=OPS');
      expect(trash).toHaveLength(1);
      expect(trash[0]).toMatchObject({ key: parent.key, subtaskCount: 1, projectKey: 'OPS', deletedBy: { name: 'Olive Owner' } });

      await post(`/trash/${parent.id}/restore`, {}, viewer, 403);
      const restored = await post(`/trash/${parent.id}/restore`, {}, member, 200);
      expect(restored.key).toBe(parent.key);
      expect((await get(`/tasks/${child.key}`)).parentId).toBe(parent.id);
      expect(await get(`/tasks/${parent.key}/comments`)).toHaveLength(1);
      expect(await get(`/tasks/${blocker.key}/links`)).toHaveLength(1);
      expect(await get('/trash')).toHaveLength(0);
    });

    it('restores into a live state after its workflow state was deleted', async () => {
      const states = await get('/projects/OPS/workflow');
      const temp = (await post('/projects/OPS/workflow/states', { name: 'Parking', category: 'TODO' })).find((s: any) => s.name === 'Parking');
      const t = await task('Parked idea', { stateId: temp.id });
      await http().delete(`/api/v1/tasks/${t.key}`).set(auth()).expect(200);
      await http().delete(`/api/v1/workflow-states/${temp.id}`).set(auth()).expect(200);
      const back = await post(`/trash/${t.id}/restore`, {}, owner, 200);
      expect(states.map((s: any) => s.id)).toContain(back.stateId);
    });

    it('only admins purge; purged tasks are gone for good', async () => {
      const t = await task('Throwaway');
      await http().delete(`/api/v1/tasks/${t.key}`).set(auth(member)).expect(200);
      await http().delete(`/api/v1/trash/${t.id}`).set(auth(member)).expect(403);
      await http().delete(`/api/v1/trash/${t.id}`).set(auth()).expect(200);
      await http().post(`/api/v1/trash/${t.id}/restore`).set(auth()).expect(404);
      await http().get(`/api/v1/tasks/${t.key}`).set(auth()).expect(404);
    });
  });

  describe('saved views', () => {
    it('keeps personal views private and shares shared ones; only owner or admin edits', async () => {
      const mine = await post('/views', { name: 'My urgent', projectId: 'OPS', config: { filters: { priority: 'URGENT' } } }, member);
      const shared = await post('/views', { name: 'Gold customers', projectId: 'OPS', shared: true, config: { filters: { cf: { tier: 'gold' } }, columns: ['key', 'title'] } }, member);
      await post('/views', { name: 'x', projectId: 'OPS', shared: true, config: {} }, viewer, 403);
      expect((await get('/views?projectId=OPS', member)).map((v: any) => v.name)).toEqual(['Gold customers', 'My urgent']);
      const ownerSees = await get('/views?projectId=OPS');
      expect(ownerSees.map((v: any) => [v.name, v.mine])).toEqual([['Gold customers', false]]);
      await patch(`/views/${mine.id}`, { name: 'hack' }, owner, 404);
      await patch(`/views/${shared.id}`, { name: 'Gold & platinum' }, owner);
      await patch(`/views/${shared.id}`, { name: 'nope' }, viewer, 403);
      await post('/views', { name: 'Too big', config: { blob: 'x'.repeat(9000) } }, member, 400);
      await http().delete(`/api/v1/views/${mine.id}`).set(auth(member)).expect(200);
      expect((await get('/views?projectId=OPS', member)).map((v: any) => v.name)).toEqual(['Gold & platinum']);
    });
  });

  describe('insights', () => {
    it('burndown tracks remaining points; completing records velocity', async () => {
      const sprint = await post('/projects/OPS/sprints', { name: 'Sprint X', startDate: iso(-5), endDate: iso(8) });
      const a = await task('Pointed A', { sprintId: sprint.id, storyPoints: 5 });
      await task('Pointed B', { sprintId: sprint.id, storyPoints: 3 });
      await task('Pointed C', { sprintId: sprint.id, storyPoints: 2 });
      await post(`/sprints/${sprint.id}/start`, {}, owner, 201);
      await patch(`/tasks/${a.key}`, { status: 'DONE' });
      const burn = await get(`/sprints/${sprint.id}/burndown`);
      expect(burn).toMatchObject({ unit: 'points', total: 10, startDate: iso(-5), endDate: iso(8) });
      expect(burn.days).toHaveLength(14);
      expect(burn.days[0]).toMatchObject({ ideal: 10, remaining: 10 });
      expect(burn.days[5]).toMatchObject({ date: iso(0), remaining: 5 });
      expect(burn.days[13]).toMatchObject({ ideal: 0, remaining: null });

      await post(`/sprints/${sprint.id}/complete`, {}, owner, 201);
      const velocity = await get('/projects/OPS/velocity');
      expect(velocity).toMatchObject({ unit: 'points', average: 5 });
      expect(velocity.sprints.at(-1)).toMatchObject({ name: 'Sprint X', committed: 10, completed: 5 });
      expect((await get(`/sprints/${sprint.id}/burndown`)).total).toBe(10);
    });

    it('workload spreads estimates per person-week against capacity; capacity is self- or admin-managed', async () => {
      const monday = ((): string => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 7);
        return d.toISOString().slice(0, 10);
      })();
      const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
      await task('Week one work', { assigneeId: memberId, estimateMinutes: 600, startDate: monday, dueDate: addDays(monday, 4) });
      await task('Split work', { assigneeId: memberId, estimateMinutes: 500, startDate: addDays(monday, 3), dueDate: addDays(monday, 9) });
      await task('Someday', { assigneeId: memberId, estimateMinutes: 90 });
      await task('Unestimated', { assigneeId: memberId, dueDate: addDays(monday, 1) });
      const w = await get(`/workload?projectId=OPS&from=${monday}&weeks=3`);
      expect(w.weeks).toEqual([monday, addDays(monday, 7), addDays(monday, 14)]);
      const mo = w.people.find((p: any) => p.user.id === memberId);
      expect(mo.weeks.map((x: any) => x.minutes)).toEqual([800, 300, 0]);
      expect(mo).toMatchObject({ capacityMinutes: 2400, unscheduled: { minutes: 90, count: 1 }, unestimated: 1 });
      expect(w.people.some((p: any) => p.user.email === 'vi@plus.test')).toBe(false);

      await patch(`/workload/capacity/${memberId}`, { hoursPerWeek: 30 }, member);
      await patch(`/workload/capacity/${ownerId}`, { hoursPerWeek: 10 }, member, 403);
      await patch(`/workload/capacity/${memberId}`, { hoursPerWeek: 32 }, owner);
      expect((await get('/workload')).people.find((p: any) => p.user.id === memberId).capacityMinutes).toBe(32 * 60);
    });
  });

  describe('intake forms', () => {
    let form: any;

    it('builds a form with custom-field questions and serves it publicly without internals', async () => {
      const fields = await get('/projects/OPS/fields');
      const tier = fields.find((x: any) => x.name === 'Tier');
      form = await post('/projects/OPS/forms', {
        name: 'Customer requests',
        description: 'Tell us what you need.',
        questions: [
          { kind: 'title', label: 'Request' },
          { kind: 'description', label: 'Details' },
          { kind: 'name', label: 'Your name', required: true },
          { kind: 'email', label: 'Email' },
          { kind: 'priority', label: 'How urgent?' },
          { kind: 'field', fieldId: tier.id, label: 'Plan', required: true },
        ],
        defaults: { type: 'STORY', assigneeId: memberId },
      });
      expect(form.publicPath).toMatch(/^\/f\/[\w-]{12}$/);
      await post('/projects/OPS/forms', { name: 'x', questions: [{ kind: 'description', label: 'd' }] }, owner, 400);
      const pub = (await http().get(`/api/v1/public/forms/${form.slug}`).expect(200)).body.data;
      expect(pub).toMatchObject({ name: 'Customer requests', organization: 'Plus', project: { name: 'Ops' } });
      expect(pub.questions.map((q: any) => q.kind)).toEqual(['title', 'description', 'name', 'email', 'priority', 'field']);
      expect(pub.questions[5].field.options.map((o: any) => o.label)).toEqual(['Gold+', 'Silver']);
      expect(JSON.stringify(pub)).not.toContain(memberId);
    });

    it('validates answers, ignores bots and turns submissions into tasks', async () => {
      const submit = (answers: Record<string, unknown>, extra: object = {}) => http().post(`/api/v1/public/forms/${form.slug}`).send({ answers, ...extra });
      const missing = await submit({ title: 'Need SSO' }).expect(400);
      expect(missing.body.error.details.missing).toEqual(['name', expect.stringMatching(/^f_/)]);
      const planQ = form.questions.find((q: any) => q.kind === 'field').id;
      await submit({ title: 'x', name: 'Bo', [planQ]: 'Silver', email: 'not-an-email' }).expect(400);
      await submit({ title: 'Spam', name: 'Bot', [planQ]: 'Silver' }, { website: 'http://spam' }).expect(201);
      const ok = (await submit({ title: 'Need SSO', description: 'SAML please', name: 'Bo Buyer', email: 'bo@customer.test', priority: 'high', [planQ]: 'silver' }).expect(201)).body.data;
      const t = await get(`/tasks/${ok.key}`);
      expect(t).toMatchObject({ title: 'Need SSO', type: 'STORY', priority: 'HIGH', assignee: { id: memberId } });
      expect(t.description).toContain('SAML please');
      expect(t.description).toContain('Submitted via form **Customer requests** by Bo Buyer <bo@customer.test>');
      expect(Object.values(t.customFields)).toHaveLength(1);
      expect((await get('/tasks?projectId=OPS&q=Spam'))).toHaveLength(0);
      expect((await get('/projects/OPS/forms'))[0]).toMatchObject({ submissionCount: 1 });
      await patch(`/forms/${form.id}`, { enabled: false });
      await http().get(`/api/v1/public/forms/${form.slug}`).expect(404);
    });
  });

  describe('CSV', () => {
    it('exports tasks with custom fields, safe for spreadsheets', async () => {
      await task('=cmd|calc', { customFields: { Customer: 'Globex', Platforms: ['Android', 'iOS'] } });
      const res = await http().get('/api/v1/projects/OPS/export.csv').set(auth()).expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="OPS-tasks-\d{4}-\d{2}-\d{2}\.csv"/);
      const rows = parseCsv(res.text);
      expect(rows[0].slice(0, 4)).toEqual(['Key', 'Title', 'Type', 'Status']);
      expect(rows[0]).toEqual(expect.arrayContaining(['Tier', 'Platforms', 'Customer']));
      const row = rows.find((r) => r[1] === "'=cmd|calc")!;
      expect(row[rows[0].indexOf('Customer')]).toBe('Globex');
      expect(row[rows[0].indexOf('Platforms')]).toBe('iOS; Android');
    });

    const jira = [
      'Issue key,Summary,Issue Type,Priority,Status,Assignee,Labels,Due Date,Story Points,Parent id,Customer,Sprint',
      'JRA-1,Checkout epic,Epic,Highest,In Progress,mo@plus.test,payments,28/Sep/26 3:15 PM,,,Acme,S1',
      'JRA-2,"Card form, validation",Story,Major,To Do,Mo Member,"payments;frontend",2026-10-02,3,JRA-1,Acme,S1',
      'JRA-3,Bad row,Bug,Low,Done,nobody@x.test,,someday,x,,,S1',
      'JRA-4,Refund flow,Task,Weird,Blocked,,,,,JRA-1,Initech,S1',
    ].join('\n');

    it('previews an import from a Jira export: auto-mapping, warnings, row errors', async () => {
      const p = await post('/projects/OPS/import', { csv: jira, dryRun: true }, owner, 200);
      expect(p.mapping).toMatchObject({ Summary: 'title', 'Issue Type': 'type', Priority: 'priority', Status: 'status', Assignee: 'assignee', Labels: 'labels', 'Due Date': 'dueDate', 'Story Points': 'storyPoints', 'Parent id': 'parent', 'Issue key': 'ignore', Sprint: 'ignore' });
      expect(p.mapping.Customer).toMatch(/^field:/);
      expect(p).toMatchObject({ total: 4, valid: 3, created: 0, newLabels: ['payments', 'frontend'] });
      const bad = p.problems.find((x: any) => x.row === 4);
      expect(bad.errors).toEqual(['due date "someday" is not a date', 'story points "x" is not a whole number']);
      expect(bad.warnings).toEqual(['assignee "nobody@x.test" is not a member; left unassigned']);
      expect(p.problems.find((x: any) => x.row === 5).warnings).toEqual(['priority "Weird" → Medium', 'status "Blocked" → To do']);
      await post('/projects/OPS/import', { csv: 'Foo,Bar\n1,2', dryRun: true }, owner, 400);
      await post('/projects/OPS/import', { csv: jira, dryRun: true }, viewer, 403);
    });

    it('imports valid rows: labels created, parents linked from the same file, custom values set', async () => {
      const r = await post('/projects/OPS/import', { csv: jira, mapping: { Sprint: 'ignore' } }, owner, 200);
      expect(r.created).toBe(3);
      expect(r.failed).toEqual([]);
      const [epic, story, refund] = await Promise.all(r.keys.map((k: string) => get(`/tasks/${k}`)));
      expect(epic).toMatchObject({ title: 'Checkout epic', type: 'EPIC', priority: 'URGENT', status: 'IN_PROGRESS', dueDate: '2026-09-28', assignee: { email: 'mo@plus.test' } });
      expect(story).toMatchObject({ title: 'Card form, validation', type: 'STORY', priority: 'HIGH', storyPoints: 3, parentId: epic.id, assignee: { name: 'Mo Member' } });
      expect(story.labels.map((l: any) => l.name)).toEqual(['frontend', 'payments']);
      expect(refund.parentId).toBe(epic.id);
      expect(Object.values(epic.customFields)).toEqual(['Acme']);
      const activity = await get('/projects/OPS/activity');
      expect(activity[0].summary).toBe(`imported 3 tasks (${r.keys[0]} – ${r.keys[2]})`);
    });
  });
});
