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
| `notifications` | who-should-know rules, in-app inbox, queues emails by category |
| `email` | SMTP transport, templates, per-user preferences, unsubscribe tokens, delivery log |
| `fields` | per-project custom field definitions; values live in `tasks.custom_values` (jsonb) |
| `views` | saved List views (personal or shared) |
| `insights` | sprint burndown, velocity, workload & capacity |
| `forms` | public intake forms whose responses become tasks |
| `csv` | CSV export and mapped import |
| `realtime` | socket.io gateway + relay of domain events to rooms |
| `jobs` | BullMQ queue + worker (project setup, email delivery, overdue scan) |
| `search` | PostgreSQL full-text search across tasks, projects, people, comments |
| `reports` | dashboard (incl. completion heatmap) and project analytics |
| `labels` | organization-wide labels |
| `time` | timers and time entries, timesheets |
| `goals` | goals/OKRs with key results and linked tasks |
| `documents` | markdown docs with compare-and-swap versioning |
| `automations` | rule engine subscribed to the event bus |
| `integrations` | outgoing webhooks (own BullMQ queue, HMAC signatures, delivery log); Slack and GitHub integrations |
| `favorites`, `roadmap` | starred projects; epics across projects on a time axis |
| `workflow` | per-project workflow states (board columns) mapped to status categories |
| `recurrence` | recurring-task rules and next-occurrence creation |

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

### Workflows

Each project owns an ordered list of `workflow_states` (name, colour, WIP limit) and every state
belongs to one of four **status categories**: `TODO`, `IN_PROGRESS`, `IN_REVIEW` or `DONE`. A task
points at a state (`state_id`), and `tasks.status` always mirrors that state's category. Board
columns are states. Reports, sprint completion, "done" timestamps, overdue checks and `STATUS_CHANGED`
automations all reason about categories, so teams can rename, add and reorder states without breaking
anything. Changing a state's category re-syncs its tasks. Deleting a state requires a `moveTo` target
when it still has tasks. Automations can also trigger on `STATE_CHANGED` and run `SET_STATE`.

### Recurring tasks

`tasks.recurrence` holds a rule (`freq` DAILY/WEEKLY/MONTHLY/YEARLY, `interval`, `byWeekday`,
`endDate`). `RecurrenceService` subscribes to `TASK_UPDATED`. When an occurrence enters a done-category
state (via drag, bulk edit, automation or API), it atomically claims `recurrence_spawned_at` and creates
the next occurrence. Dates are advanced by the rule and never land in the past. Assignee, labels, estimate,
epic and an open sprint carry over, and every occurrence shares a `series_id`. Rule maths lives in a pure
module (`recurrence.ts`) with its own unit tests.

### Slack & GitHub

Both live in `modules/integrations` and are stored as `integrations` rows (`provider`, `config` jsonb, a
`secret` column that is never selected by default, health fields `last_status/last_error/last_activity_at`).
Inbound hooks are public routes under `/api/v1/hooks`, where the raw request body is kept so signatures can
be checked byte-for-byte.

- **Slack out:** `SlackService` subscribes to the event bus, filters by the integration's events and project,
  and enqueues `slack.post` jobs on the `workora-integrations` BullMQ queue. The processor POSTs Block Kit
  messages (user text is escaped) to the Incoming Webhook and records health.
- **Slack in:** `POST /hooks/slack/:id/commands` verifies `v0` signatures (HMAC-SHA256 of
  `v0:timestamp:body`, 5-minute replay window) and answers with an ephemeral response. `create` runs through
  `TasksService` as the integration's author, so it is validated, audited and broadcast like any other change.
- **GitHub in:** `POST /hooks/github/:id` verifies `X-Hub-Signature-256` and handles `pull_request`, `push` and
  `issues`. Task keys are extracted from titles, bodies, branch names and commit messages. Links are upserted into
  `external_links` (unique per task and external id, so redeliveries are harmless) and publish `DEV_LINKED`.
  PR opened or merged moves the task to the configured state or category, but **only forward** by category
  rank. `fixes/closes/resolves KEY` on the default branch and closed linked issues complete tasks. New issues
  can create tasks (a `bug` label makes them bugs). Changes are attributed to e.g. "octocat via GitHub".

### Custom fields

Definitions are `custom_fields` rows per project (type, options with stable ids, position, required, shown in List).
Values are stored on the task as `custom_values` jsonb keyed by field id, so a task carries its values without
joins and the List can filter with jsonb containment: `?cf={"<fieldId>": value}` becomes
`custom_values -> fieldId @> value`, which matches equal scalars and multi-select arrays that contain the value
(a GIN index backs it). Values are validated per type on write; select values accept option ids or labels
(case-insensitive), which is what CSV import and forms use. Renaming an option keeps its id; removing one prunes it
from tasks; deleting a field removes its key from every task.

### Trash (soft delete)

The real table is `tasks_all`; `tasks` is an automatically updatable Postgres view of the rows where
`deleted_at IS NULL`. Every existing query — TypeORM entities, raw SQL, joins in reports and search — therefore
skips trashed tasks with no changes, while foreign keys and indexes stay on the table. Deleting a task stamps
`deleted_at` on it and its subtasks in one statement; restore and purge find that batch by the same timestamp
(compared in SQL, since Postgres keeps microseconds). A job purges rows older than 30 days. **A migration that adds
columns to `tasks_all` must recreate the view** (`CREATE OR REPLACE VIEW tasks AS SELECT * FROM tasks_all WHERE
deleted_at IS NULL`).

### Insights

- *Burndown*: the sprint's tasks, valued in story points (or 1 per task when unpointed), minus what was completed by
  each day; a completed sprint uses its committed total from `sprints.completion_stats`, a snapshot taken when the
  sprint completes (unfinished tasks go back to the backlog and would otherwise vanish from the scope).
- *Velocity*: committed vs completed from those snapshots for the last 8 sprints.
- *Workload*: each open task's estimate is spread evenly over the working days from its start (or due) date to its
  due date; days before the window (overdue work) count in the first week; tasks without a due date are
  "unscheduled". Capacity is `memberships.weekly_capacity_minutes`.

### Forms and CSV import

Both create tasks through `TasksService.create`, so validation, numbering, events, automations, notifications and
webhooks behave exactly as for tasks created in the UI. Form submissions act as the form's creator with the display
name "<name> via form"; a hidden honeypot field silently drops bot submissions. CSV import parses RFC 4180 (quotes,
embedded newlines, BOM, `,`/`;`/tab), maps headers through a synonym table (Jira, Asana, Trello, ClickUp, Linear),
runs as a dry run first to report row errors and warnings, creates missing labels, and links parents either to
existing keys or to other rows of the same file via its key column. Export neutralises spreadsheet formulas.

### Email

`NotificationListener` gives each notification draft an email *category* (`assigned`, `mentioned`, `overdue`,
`automation`, `workspace`, `comments`, `status`, `sprints`). For recipients whose preferences allow it, it queues a
`notification.email` job. Preferences are stored as sparse overrides in `users.email_prefs` and merged with
per-category defaults. The job processor calls `EmailService.deliver`, which:

1. re-checks preferences, so an unsubscribe also stops mail that is already queued;
2. renders the HTML (table layout with inline styles, all user text escaped) and plain-text versions;
3. sends through a pooled nodemailer SMTP transport, or a JSON transport that only logs when SMTP is not configured;
4. records the final outcome in `email_deliveries`.

5xx rejections fail immediately (`UnrecoverableError`). 4xx and network errors retry with exponential backoff,
up to 5 attempts.

Unsubscribe tokens are `base64url(userId:category).HMAC` under a key derived from `JWT_SECRET`. They don't
expire and can only turn email off. Emails link to the SPA's `/unsubscribe` confirmation page (a GET changes
nothing, so link scanners are harmless). They also carry `List-Unsubscribe` / `List-Unsubscribe-Post` headers
pointing at `POST /api/v1/email/unsubscribe` for RFC 8058 one-click unsubscribes.

### Notifications and desktop push

`NotificationListener` turns domain events into notifications. Each one has a *category* (the email categories
plus `security`) and, when it isn't about the event's task, an in-app `link` (`/trash`, a project's goals or
sprint page, `/settings`). The actor never notifies themselves. Who hears about what:

| Event | Recipients |
|-------|------------|
| Assigned / taken off | new assignee / previous assignee |
| Comment | @mentioned people (as a mention), then watchers, assignee and reporter |
| State change | watchers, reporter and assignee |
| Priority or due date change, file added, now blocked, trashed, restored | watchers (assignees watch their tasks automatically); for blockers, those of the blocked task |
| Due tomorrow / overdue | assignee (the job scan writes `task_reminders`, one per task and due date) |
| GitHub PR linked, merged or closed; issue linked | watchers and assignee |
| Next recurring occurrence | its assignee |
| Form response | the form's creator (the event has no actor, so the creator still hears) |
| Goal updated | its owner |
| Sprint started / completed | everyone with work in it |
| 2FA turned on or off, recovery code used | the account, in every workspace (`SECURITY_NOTICE`) |

Each notification is stored, sent over the websocket to the user's room, queued as email if the person's email
preferences allow it, and sent as Web Push if their desktop preferences (`users.push_prefs`, sparse overrides,
every kind on by default) allow it. Security notices ignore preferences.

`PushService` implements Web Push with the `web-push` library: VAPID (RFC 8292) and aes128gcm payload
encryption (RFC 8291). Each browser is a row in `push_subscriptions`, unique by endpoint, so a shared computer
moves to whoever turns it on. A 404 or 410 from the push service deletes the row, and so do 10 failures in a row.
In production, endpoints must be https on a known push service (FCM, Mozilla, Windows, Apple), so a subscription
can't be used for SSRF. The VAPID key pair comes from the environment, or is generated once and stored sealed in
`app_secrets`. The payload carries the title, body, workspace name, category and an absolute URL with
`?org=<id>`. Opening that URL switches workspace when needed.

In the browser, `public/sw.js` (scope `/workora/`) shows each push, unless a Workora tab is focused (the
toast covers it then). On click it focuses an open tab and asks it to navigate (`postMessage`), or opens a new
window. Where push is unavailable, the app falls back to `tab` mode: when it is in the background, the realtime
handler asks the service worker to show the notification.

### Two-factor authentication

TOTP follows RFC 6238: SHA-1, 6 digits, 30-second steps, and one step of clock drift accepted either way. The
last accepted step is stored in `users.totp_last_step` and advanced with a conditional `UPDATE`, so a code can't
be used twice, even by two requests at the same time. Secrets are sealed with `SecretBox` (AES-256-GCM,
`v1.iv.tag.data`). Recovery codes are stored as SHA-256 hashes and spent with an atomic jsonb `-`.

Sign-in has two steps. When 2FA is on, `POST /auth/login` returns `{ mfaRequired, mfaToken }`. The `mfaToken` is a
5-minute JWT with `typ: 'mfa'` that `TokenService.authenticate` never accepts as a session. `POST /auth/login/2fa`
exchanges it plus a code for a session token with `amr: 'mfa'`. When `organizations.require_2fa` is set, a
password session without 2FA gets `403 MFA_SETUP_REQUIRED` on every route except those marked
`@AllowWithoutMfa` (`/auth/me`, 2FA setup, switching workspace). The SPA then shows a setup gate. SSO sessions are
exempt because the identity provider applies its own MFA.

### Single sign-on (OIDC)

Each workspace has at most one `sso_connections` row. It holds the issuer, the client ID, the sealed client
secret, the claimed email domains (unique across workspaces) and the auto-provision, default-role and enforce
flags. Identities link through `user_identities (connection_id, subject)`, so a changed email at the provider
doesn't create a new account.

1. `GET /auth/sso/discover?email=` tells the login page whether the domain has SSO and whether it is enforced.
2. `GET /auth/sso/start` creates the state, nonce and PKCE verifier and seals them into an HttpOnly cookie scoped
   to `/api/v1/auth/sso`. It then redirects to the provider's authorization endpoint (S256 challenge).
3. `GET /auth/sso/callback` checks that `state` matches the cookie and exchanges the code (with the verifier).
   It then verifies the ID token: RS*/ES* signature against the provider's JWKS (cached, refetched for an unknown
   `kid`), `iss`, `aud`, `exp`/`iat` with 2 minutes of skew, and `nonce`. An email the provider marks unverified is refused.
4. It links an existing identity, or an existing member with that email, or creates the user if auto-provision is
   on. The session token (`amr: 'sso'`) goes back to the SPA in the URL fragment (`/sso/callback#token=`). The
   SPA removes it from history before loading the session. Failures redirect to `/login?sso_error=` and are
   recorded on the connection.

When SSO is enforced, password sign-in fails with `SSO_REQUIRED` for those domains. Owners are the exception,
so a misconfigured provider can't lock the workspace out.

### Board ordering

Each task has a dense, zero-based `position` within its `(project, workflow state)` column.
`PATCH /tasks/:id/status { status, position }` locks the project row (`SELECT … FOR UPDATE`),
removes the task from its old column, inserts it at `position` in the new one, and rewrites both
columns' positions. That serializes concurrent drags within a project.

### Events

`TASK_CREATED`, `TASK_UPDATED`, `TASK_ASSIGNED`, `TASK_DELETED`, `TASK_LINKED`, `TASK_OVERDUE`,
`COMMENT_CREATED`, `ATTACHMENT_ADDED`, `ATTACHMENT_DELETED`, `TIME_LOGGED`, `PROJECT_CREATED`, `PROJECT_UPDATED`,
`SPRINT_CREATED`, `SPRINT_UPDATED`, `SPRINT_STARTED`, `SPRINT_COMPLETED`, `DOCUMENT_CREATED`, `DOCUMENT_UPDATED`,
`DOCUMENT_DELETED`, `GOAL_CREATED`, `GOAL_UPDATED`, `AUTOMATION_RAN`, `USER_ADDED`, `DEV_LINKED`, `FIELDS_UPDATED`,
`VIEWS_UPDATED`, `TASK_RESTORED`, `TASKS_IMPORTED`.

### Automations

`AutomationsService` subscribes to the event bus. For each event it maps the event to triggers
(`STATUS_CHANGED{from,to}`, `PRIORITY_CHANGED`, `TASK_CREATED`, `ASSIGNED`, `COMMENT_ADDED`,
`TASK_OVERDUE`), loads the project's enabled rules, checks conditions (type, priority, label) and runs
the actions **through the normal services** as the rule's author. Because those changes flow through the
same services, they are validated, audited, broadcast and delivered to webhooks like any other change.
The acting principal carries `automation: <ruleId>`. Events from rule-made changes carry
`actor.automation` and are ignored by the engine, so rules can never trigger each other in a loop.

### Recurring jobs

`JobScheduler` registers a BullMQ job scheduler (`tasks.overdue-scan`, every 15 min). It marks newly overdue
tasks (`overdue_notified_at`) and publishes `TASK_OVERDUE` once per task. The marker resets when the due date changes.

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
