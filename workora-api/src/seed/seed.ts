import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { AuthPrincipal } from '../common/auth/principal';
import { Role } from '../common/auth/roles';
import { AuthService } from '../modules/auth/auth.service';
import { CommentsService } from '../modules/comments/comments.module';
import { OrganizationsService } from '../modules/organizations/organizations.service';
import { ProjectsService } from '../modules/projects/projects.service';
import { Sprint } from '../modules/sprints/sprint.entity';
import { SprintsService } from '../modules/sprints/sprints.module';
import { TaskPriority, TaskStatus, TaskType } from '../modules/tasks/task.entity';
import { TasksService } from '../modules/tasks/tasks.service';
import { User } from '../modules/users/user.entity';
import { AutomationsService } from '../modules/automations/automations.module';
import { DocumentsService } from '../modules/documents/documents.module';
import { GoalsService } from '../modules/goals/goals.module';
import { KeyResultKind } from '../modules/goals/goal.entity';
import { Label } from '../modules/labels/label.entity';
import { TaskLinkType } from '../modules/tasks/task-link.entity';
import { TimeService } from '../modules/time/time.module';

const PASSWORD = 'workora123';
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  app.enableShutdownHooks();
  const db = app.get(DataSource);

  if (await db.getRepository(User).existsBy({ email: 'demo@workora.dev' })) {
    console.log('Demo data already present — nothing to do.');
    await app.close();
    return;
  }

  const auth = app.get(AuthService);
  const orgs = app.get(OrganizationsService);
  const projects = app.get(ProjectsService);
  const tasks = app.get(TasksService);
  const sprints = app.get(SprintsService);
  const comments = app.get(CommentsService);

  const session = await auth.register({ name: 'Alex Morgan', email: 'demo@workora.dev', password: PASSWORD, organizationName: 'Acme Inc' });
  const owner: AuthPrincipal = { userId: session.user!.id, organizationId: session.organization.id, role: Role.OWNER, email: 'demo@workora.dev', name: 'Alex Morgan' };
  const rahul = await orgs.addMember(owner, { email: 'rahul@workora.dev', name: 'Rahul Sharma', password: PASSWORD, role: Role.MEMBER });
  const priya = await orgs.addMember(owner, { email: 'priya@workora.dev', name: 'Priya Patel', password: PASSWORD, role: Role.ADMIN });
  await orgs.addMember(owner, { email: 'viewer@workora.dev', name: 'Sam Viewer', password: PASSWORD, role: Role.VIEWER });
  const as = (u: typeof rahul): AuthPrincipal => ({ userId: u.user!.id, organizationId: owner.organizationId, role: u.role, email: u.user!.email, name: u.user!.name });
  const R = as(rahul);
  const P = as(priya);

  const ecom = await projects.create(owner, { name: 'E-Commerce Platform', key: 'ECOM', description: 'Checkout, catalog and payments for the new storefront.', color: '#6366f1' });
  const mobile = await projects.create(P, { name: 'Mobile App', key: 'MOB', description: 'iOS & Android companion app.', color: '#10b981' });
  await projects.create(owner, { name: 'Marketing Website', key: 'WEB', description: 'Public marketing site and blog.', color: '#f59e0b' });

  // The project-setup background job creates "Sprint 1"; wait for it and start it.
  let sprint: Sprint | null = null;
  for (let i = 0; i < 50 && !sprint; i++) {
    sprint = await db.getRepository(Sprint).findOneBy({ projectId: ecom.id });
    if (!sprint) await new Promise((r) => setTimeout(r, 100));
  }
  const sprintId = sprint ? sprint.id : (await sprints.create(owner, ecom.id, { name: 'Sprint 1' })).id;

  type Seed = [string, TaskStatus, TaskPriority, AuthPrincipal | null, number | null, number | null, TaskType?, boolean?];
  const ecomTasks: Seed[] = [
    ['Set up product catalog schema', TaskStatus.DONE, TaskPriority.HIGH, R, -6, 3],
    ['Design checkout flow', TaskStatus.DONE, TaskPriority.MEDIUM, P, -3, 5, TaskType.STORY],
    ['Implement Payment API', TaskStatus.IN_PROGRESS, TaskPriority.HIGH, R, 3, 8, TaskType.STORY],
    ['Cart persistence across devices', TaskStatus.IN_PROGRESS, TaskPriority.MEDIUM, owner, 5, 5],
    ['Order confirmation emails', TaskStatus.IN_REVIEW, TaskPriority.MEDIUM, P, 2, 3],
    ['Fix rounding error in tax calculation', TaskStatus.TODO, TaskPriority.URGENT, R, -1, 2, TaskType.BUG],
    ['Add Apple Pay / Google Pay', TaskStatus.TODO, TaskPriority.HIGH, null, 9, 8, TaskType.STORY],
    ['Inventory sync with warehouse', TaskStatus.TODO, TaskPriority.MEDIUM, owner, 12, 5],
    ['Discount codes & promotions', TaskStatus.TODO, TaskPriority.LOW, null, null, 5, TaskType.STORY, true],
    ['Product reviews & ratings', TaskStatus.TODO, TaskPriority.LOW, null, null, 8, TaskType.EPIC, true],
    ['Guest checkout', TaskStatus.TODO, TaskPriority.MEDIUM, P, null, 3, TaskType.STORY, true],
  ];
  const created: Record<string, string> = {};
  for (const [title, status, priority, who, due, points, type, backlog] of ecomTasks) {
    const t = await tasks.create(owner, {
      projectId: ecom.id,
      title,
      status,
      priority,
      type: type ?? TaskType.TASK,
      assigneeId: who?.userId ?? null,
      storyPoints: points,
      dueDate: due === null ? null : day(due),
      startDate: due === null ? null : day(due - 4),
      sprintId: backlog ? null : sprintId,
      description: title === 'Implement Payment API' ? 'Integrate the payment provider:\n\n- Create payment intents\n- Handle webhooks\n- Idempotency keys for retries' : '',
    });
    created[title] = t.key;
  }
  await sprints.start(owner, sprintId);

  const payment = created['Implement Payment API'];
  await comments.create(P, payment, 'Can we make sure webhooks are idempotent? @rahul');
  await comments.create(R, payment, 'Yes — using the event id as the idempotency key. PR coming today.');
  await comments.create(R, created['Fix rounding error in tax calculation'], '@alex this breaks totals for some EU carts, bumping to urgent.');

  for (const [title, status, who, due] of [
    ['Push notification service', TaskStatus.IN_PROGRESS, P, 4],
    ['Offline mode for order history', TaskStatus.TODO, owner, 10],
    ['Biometric login', TaskStatus.TODO, R, 7],
  ] as const) {
    await tasks.create(P, { projectId: mobile.id, title, status, assigneeId: who.userId, dueDate: day(due), priority: TaskPriority.MEDIUM });
  }

  // ── Labels, epics, subtasks and dependencies
  const labelRepo = db.getRepository(Label);
  const [lFrontend, lBackend, lPayments, lCustomer] = await labelRepo.save(
    [
      ['Frontend', '#0ea5e9'],
      ['Backend', '#8b5cf6'],
      ['Payments', '#f59e0b'],
      ['Customer request', '#ec4899'],
    ].map(([name, color]) => labelRepo.create({ organizationId: owner.organizationId, name, color })),
  );
  const epic = await tasks.create(owner, {
    projectId: ecom.id,
    title: 'Checkout v2',
    type: TaskType.EPIC,
    priority: TaskPriority.HIGH,
    assigneeId: owner.userId,
    startDate: day(-8),
    dueDate: day(24),
    description: 'Faster, wallet-first checkout. Target: +15% conversion.',
    labelIds: [lPayments.id],
  });
  for (const [title, labels] of [
    ['Design checkout flow', [lFrontend.id]],
    ['Implement Payment API', [lBackend.id, lPayments.id]],
    ['Add Apple Pay / Google Pay', [lFrontend.id, lPayments.id, lCustomer.id]],
    ['Guest checkout', [lFrontend.id, lCustomer.id]],
    ['Fix rounding error in tax calculation', [lBackend.id]],
  ] as const) {
    await tasks.update(owner, created[title], { parentId: epic.id, labelIds: [...labels] });
  }
  await tasks.update(owner, created['Cart persistence across devices'], { labelIds: [lFrontend.id, lBackend.id], estimateMinutes: 480 });
  await tasks.update(owner, payment, { estimateMinutes: 960 });
  await tasks.create(R, { projectId: ecom.id, title: 'Webhook signature verification', parentId: (await tasks.get(owner.organizationId, payment)).id, status: TaskStatus.DONE, assigneeId: R.userId, sprintId });
  await tasks.create(R, { projectId: ecom.id, title: 'Idempotency keys for retries', parentId: (await tasks.get(owner.organizationId, payment)).id, assigneeId: R.userId, sprintId });
  await tasks.addLink(owner, payment, { targetId: created['Add Apple Pay / Google Pay'], type: TaskLinkType.BLOCKS });
  await tasks.watch(owner, payment, P.userId);
  const reviewsEpic = created['Product reviews & ratings'];
  await tasks.update(owner, reviewsEpic, { startDate: day(20), dueDate: day(55) });
  await tasks.create(P, { projectId: mobile.id, title: 'App Store launch', type: TaskType.EPIC, startDate: day(2), dueDate: day(40), assigneeId: P.userId });

  // ── Time tracking
  const time = app.get(TimeService);
  await time.log(R, payment, { minutes: 150, note: 'Payment intents + webhook handler' });
  await time.log(R, payment, { minutes: 95, date: day(-1), note: 'Idempotency spike' });
  await time.log(owner, created['Cart persistence across devices'], { minutes: 120, date: day(-2) });
  await time.log(P, created['Order confirmation emails'], { minutes: 75, date: day(-1) });

  // ── Goals / OKRs
  const goals = app.get(GoalsService);
  const g1 = await goals.create(owner, { title: 'Ship wallet-first checkout this quarter', projectId: ecom.id, dueDate: day(45) });
  await goals.addKeyResult(owner, g1.id, { title: 'Checkout conversion', startValue: 2.1, targetValue: 3.0, currentValue: 2.4, unit: '%' });
  await goals.addKeyResult(owner, g1.id, { title: 'Checkout v2 tasks complete', kind: KeyResultKind.TASKS });
  for (const title of ['Design checkout flow', 'Implement Payment API', 'Add Apple Pay / Google Pay', 'Guest checkout']) await goals.linkTask(owner, g1.id, created[title]);
  const g2 = await goals.create(P, { title: 'Launch the mobile app', projectId: mobile.id, dueDate: day(60) });
  await goals.addKeyResult(P, g2.id, { title: 'Beta testers', startValue: 0, targetValue: 500, currentValue: 180, unit: 'users' });
  await goals.update(P, g2.id, { status: 'AT_RISK' as any });

  // ── Documents
  const docs = app.get(DocumentsService);
  await docs.create(owner, {
    projectId: ecom.id,
    title: 'Checkout v2 — launch plan',
    icon: '🚀',
    content:
      '# Checkout v2\n\nWallet-first checkout for the new storefront.\n\n## Milestones\n\n- [x] Checkout flow designed\n- [ ] Payment API live in staging\n- [ ] Apple Pay / Google Pay\n- [ ] Guest checkout\n\n## Risks\n\n> Tax rounding bug (ECOM-6) must ship before launch.\n\nOwner: **Alex** · Payments: **Rahul**',
  });
  await docs.create(R, {
    projectId: ecom.id,
    title: 'Payment API design notes',
    icon: '💳',
    content: '# Payment API\n\n## Endpoints\n\n- `POST /payments/intents`\n- `POST /payments/webhooks`\n\n## Idempotency\n\nEvery mutating request carries an `Idempotency-Key` header; we store the first response for 24h.',
  });
  await docs.create(owner, {
    title: 'Team handbook',
    icon: '📘',
    content: '# How we work\n\n1. Plan in the **backlog**, commit in **sprints**.\n2. Anything urgent gets the *Urgent* priority — an automation pings the watchers.\n3. Log time on tasks with the timer.\n\nPress `Ctrl K` anywhere to jump around.',
  });

  // ── Automations & favorites
  const automations = app.get(AutomationsService);
  await automations.create(owner, ecom.id, {
    name: 'Done → celebrate',
    trigger: { event: 'STATUS_CHANGED', to: 'DONE' },
    actions: [{ type: 'ADD_COMMENT', body: 'Shipped ✅ Nice work on {task.key}!' }],
  });
  await automations.create(owner, ecom.id, {
    name: 'Urgent bugs → alert watchers',
    trigger: { event: 'PRIORITY_CHANGED', to: 'URGENT' },
    conditions: { type: 'BUG' },
    actions: [{ type: 'MOVE_TO_ACTIVE_SPRINT' }, { type: 'NOTIFY', target: 'WATCHERS', message: '🔥 {task.key} is now urgent' }],
  });
  await automations.create(owner, ecom.id, {
    name: 'New bugs → Rahul',
    trigger: { event: 'TASK_CREATED' },
    conditions: { type: 'BUG' },
    actions: [{ type: 'ASSIGN', userId: R.userId }, { type: 'ADD_LABEL', labelId: lBackend.id }],
  });
  await db.query('INSERT INTO favorites (user_id, project_id) VALUES ($1, $2), ($1, $3)', [owner.userId, ecom.id, mobile.id]);

  // ── History: finished work spread over the last ~10 weeks (feeds the Momentum heatmap)
  const chores = ['Crash reporting', 'Deep links', 'Onboarding copy', 'Dark mode polish', 'Icon set', 'Push opt-in', 'Analytics events', 'Splash screen', 'Settings screen', 'Accessibility audit', 'Image caching', 'Error states', 'Release notes', 'Beta invites'];
  for (const title of chores) {
    await tasks.create(owner, { projectId: mobile.id, title, status: TaskStatus.DONE, assigneeId: owner.userId, priority: TaskPriority.LOW });
  }
  await db.query(
    `UPDATE tasks SET completed_at = now() - ((abs(hashtext(id::text)) % 68) + 1) * interval '1 day'
      WHERE project_id = $1 AND status = 'DONE'`,
    [mobile.id],
  );

  await new Promise((r) => setTimeout(r, 1500)); // let async subscribers finish
  console.log(`Seeded demo data. Sign in as demo@workora.dev / ${PASSWORD} (also rahul@, priya@, viewer@workora.dev).`);
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
