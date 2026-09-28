# Workora architecture

```
                 ┌──────────────────────────────────────┐
                 │            WORKORA SPA               │
                 │ React Router · TanStack Query cache  │
                 │ Zustand (UI + session) · socket.io   │
                 └───────────────┬──────────────────────┘
                     HTTPS REST  │  WebSocket (/api/v1/realtime)
                                 ▼
                 ┌──────────────────────────────────────┐
                 │          API (NestJS, /api/v1)       │
                 │ JwtAuthGuard → UserThrottlerGuard →  │
                 │ RolesGuard → ValidationPipe →        │
                 │ controller → service (transaction)   │
                 │ ResponseEnvelopeInterceptor /        │
                 │ ApiExceptionFilter                   │
                 └───────────────┬──────────────────────┘
                                 │ after commit
                                 ▼
                        EventBus (DomainEvent)
          ┌──────────────┬───────┴────────┬───────────────┐
          ▼              ▼                ▼               ▼
   ActivityListener  NotificationListener RealtimeRelay  JobScheduler
   (audit log)       (in-app + email job) (socket rooms)  (BullMQ)
          │              │                │               │
          ▼              ▼                ▼               ▼
      PostgreSQL     PostgreSQL       Redis adapter     Redis queue → JobsProcessor
```

## Backend (`workora-api/`)

A **modular monolith**: each folder under `src/modules` owns its entity, API and event
subscribers. Modules talk to each other through the event bus rather than calling each other.

| Module | Responsibility |
|--------|----------------|
| `auth` | register, login, `me`, switch organization (issues JWTs) |
| `organizations` | tenants, memberships, roles |
| `users`, `teams` | people directory, teams |
| `projects` | projects (key such as `ECOM`), board endpoint |
| `tasks` | tasks & issues (`type`), filtering, PATCH semantics, drag & drop ordering |
| `sprints` | plan / start / complete (unfinished work returns to backlog) |
| `comments` | comments with `@mentions` |
| `attachments`, `storage` | signed-URL uploads and downloads |
| `activity` | append-only audit log built from domain events |
| `notifications` | who-should-know rules, in-app inbox, email jobs |
| `realtime` | socket.io gateway + relay of domain events to rooms |
| `jobs` | BullMQ queue + worker (project setup, email) |
| `search` | PostgreSQL full-text search across tasks, projects, people, comments |
| `reports` | dashboard and project analytics |

### Request pipeline

1. **`JwtAuthGuard`** verifies the bearer token and loads the *current* membership, so revoking a
   member or changing a role takes effect immediately. It sets `req.user = { userId, organizationId, role }`.
2. **`UserThrottlerGuard`** applies fixed-window rate limits in Redis, keyed per user (or IP when
   anonymous), shared across instances.
3. **`RolesGuard`** enforces `@MinRole(Role.MEMBER)` and similar, using the hierarchy OWNER › ADMIN › MEMBER › VIEWER.
4. **`ValidationPipe`** (class-validator) whitelists input; failures become `VALIDATION_ERROR`
   with per-field `details`.
5. Services run their writes in a transaction and publish a `DomainEvent` **after it commits**.
6. **`ResponseEnvelopeInterceptor`** wraps results as `{ success: true, data, meta }`.
   **`ApiExceptionFilter`** turns every error into `{ success: false, error: { code, message } }`.

### Multi-tenancy

Every tenant-owned row carries `organization_id`, and every query filters on the caller's
organization. A lookup by id or key in another tenant returns 404, never 403, so the API does not
reveal that the resource exists. A user can belong to several organizations and switches between
them with `POST /auth/switch-organization`.

### Board ordering

Each task has a dense, zero-based `position` within its `(project, status)` column.
`PATCH /tasks/:id/status { status, position }` locks the project row (`SELECT … FOR UPDATE`),
removes the task from its old column, inserts it at `position` in the new one, and rewrites both
columns' positions. That serializes concurrent drags within a project.

### Events

`TASK_CREATED`, `TASK_UPDATED`, `TASK_ASSIGNED`, `TASK_DELETED`, `COMMENT_CREATED`, `ATTACHMENT_ADDED`,
`ATTACHMENT_DELETED`, `PROJECT_CREATED`, `PROJECT_UPDATED`, `SPRINT_CREATED`, `SPRINT_UPDATED`,
`SPRINT_STARTED`, `SPRINT_COMPLETED`, `USER_ADDED`.

```ts
interface DomainEvent<T> {
  id: string; type: DomainEventType; organizationId: string; projectId?: string;
  actor: { id: string; name: string } | null; occurredAt: string; data: T;
}
```

Adding a subsystem (automation rules, analytics, webhooks…) means adding one more
`@OnEvent(DOMAIN_EVENT)` subscriber. No existing service changes.

### Realtime protocol

- Connect with `io({ path: '/api/v1/realtime', auth: { token } })`. Invalid tokens are disconnected.
- On connect the socket joins `org:<id>` and `user:<id>` and receives `ready`.
- `emit('subscribe', { projectId })` joins `project:<id>` after checking the project is in the tenant; the ack is `{ ok }`.
- The server emits `event` with `{ id, type, projectId, actor, occurredAt, data }`. Task events also go to
  the assignee's user room, which keeps "My Work" live. `NOTIFICATION_CREATED` goes to the recipient only.
- `@socket.io/redis-adapter` fans broadcasts out across API instances.

### Files

1. `POST /tasks/:id/attachments/upload-url` returns `{ uploadUrl, storageKey }` (HMAC-signed, 15 min TTL).
2. The browser `PUT`s the bytes to `uploadUrl`.
3. `POST /tasks/:id/attachments { storageKey, fileName }` records the attachment, which emits `ATTACHMENT_ADDED`.

The bundled driver writes to local disk. An S3 driver only needs `StorageService.signedUrl`
to return presigned URLs.

## Frontend (`workora-web/`)

```
src/
  app/          router (lazy routes), providers (QueryClient), layouts (AppShell), ui.store
  features/     auth, dashboard, my-work, projects, tasks, boards, sprints, reports,
                notifications, search, command-palette, administration, teams, placeholders
  components/ui primitives: Avatar, badges, Skeleton, Dialog, toasts, …
  services/     api client (envelope → data | ApiError), query keys, realtime client
  hooks/ utils/ types/ config/
```

State is kept in three separate places:

| Kind | Where | Examples |
|------|-------|----------|
| Server state | TanStack Query | projects, tasks, board, comments, notifications |
| UI state | `useUiStore` (Zustand) | sidebar, theme, palette open, create dialogs |
| Session | `useSessionStore` (Zustand, persisted) | token, user, organization, role |
| URL state | React Router | current view, `?task=` (drawer), filters |

- **Caching:** `staleTime` is 30 s and `gcTime` 10 min. Cached data renders immediately and is
  revalidated in the background. The task drawer uses any cached board/list copy as placeholder data.
- **Optimistic UI:** drags update the board cache during the drag. Field edits, comments and deletes
  patch every cached copy. On failure the pre-mutation snapshot is restored and a toast explains why.
- **Realtime:** `services/websocket/realtime.ts` applies events straight to the query cache. On
  reconnect it invalidates all queries to catch up on anything missed.
- **Lazy loading:** only the app shell, auth and dashboard are in the entry chunk. Project views,
  reports, admin, teams and placeholders load on first use.

## Scaling path

- **Search:** move from Postgres FTS to OpenSearch behind the same `/search` contract.
- **Workers:** run BullMQ processors in a separate process (`JobsModule` only) for heavy jobs.
- **Read models:** have `ReportsModule` read from event-fed aggregates once live queries get expensive.
- **Extraction:** the event bus boundary is where a module would split into its own service
  (for example, notifications).
