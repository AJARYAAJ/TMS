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

  await new Promise((r) => setTimeout(r, 1500)); // let async subscribers finish
  console.log(`Seeded demo data. Sign in as demo@workora.dev / ${PASSWORD} (also rahul@, priya@, viewer@workora.dev).`);
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
