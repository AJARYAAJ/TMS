# Workora

**API-first, real-time, multi-tenant work & project operations platform.**

SPA · REST API · WebSocket · RBAC · Multi-tenancy · Optimistic UI · Real-time collaboration ·
Event-driven architecture · Background jobs · Caching · API versioning · Audit logging

```
workora-api/   NestJS modular monolith  (REST /api/v1, socket.io gateway, BullMQ workers)
workora-web/   React + TypeScript SPA   (Vite, TanStack Query, dnd-kit, socket.io-client)
docs/          Architecture notes
```

## Quick start

Requirements: Node 20+, PostgreSQL 14+, Redis 6+ (or Docker).

```bash
docker compose up -d                      # PostgreSQL + Redis + Mailpit (dev inbox: http://localhost:8025)

cd workora-api
cp .env.example .env                      # optional; defaults match docker-compose
npm install
npm run seed                              # runs migrations + creates demo workspace
npm run start:dev                         # http://localhost:3000/api/v1  (Swagger: /api/docs)

cd ../workora-web
npm install
npm run dev                               # http://localhost:5173/workora/
```

Sign in with **demo@workora.dev / workora123**. `rahul@`, `priya@` and `viewer@workora.dev` (same password)
have MEMBER, ADMIN and VIEWER roles — open two browsers to watch real-time updates.

Keyboard: **Ctrl/⌘ K** command palette · **/** search · **C** create task · **Esc** close drawer.

## What's implemented

**Work management**

| Area | Details |
|------|---------|
| **Tasks & issues** | Types (task, bug, story, epic), epics → tasks → subtasks with progress roll-up, labels, watchers, estimates, story points, start/due dates |
| **Dependencies** | *blocks / blocked by / relates / duplicates*, cycle detection, blocked badges on cards |
| **Views** | Overview, List (filters, custom-field columns, multi-select bulk edit), Board (drag & drop + quick filters by person/label/priority), Backlog, Sprint, Calendar, Timeline, Roadmap, Goals, Docs, Reports, Automations, Workflow, Fields, Forms |
| **Custom fields** | Per-project text, number, dropdown, tags, date, checkbox, link and person fields — edited inline in the task sheet, shown as List columns, filterable, on intake forms and in CSV import/export |
| **Saved views** | Save List filters (incl. custom-field filters) as personal or shared views |
| **Labels** | Workspace-wide, with colour and description; rename (with duplicate check), merge duplicates, bulk add/remove, usage counts and a label page listing its tasks across projects |
| **Workload** | People × weeks grid of estimated hours against each member's weekly capacity (estimates spread over working days); over-capacity flagged; per-person task breakdown |
| **Sprint analytics** | Burndown (points or task count) against the ideal line, and velocity (committed vs completed) from sprint completion snapshots |
| **Intake forms** | Build a form from built-in and custom-field questions with a live preview; share a public link; every response becomes a task (honeypot spam protection) |
| **Import / export** | CSV export of any project (Excel-safe, formula-neutralised); CSV import with automatic column mapping for Jira, Asana, Trello, ClickUp and Linear exports, a preview of problems, label creation and parent links |
| **Trash** | Deleting a task (and its subtasks) moves it to the trash with an Undo toast; restore within 30 days, admins can delete forever |
| **Discoverability** | Explore hub of every feature, a self-checking “Get started” checklist on Home, `?` shortcut cheat sheet, `G` then H/M/I/P/W/R/T/E/S navigation, and every feature in the command palette |
| **Custom workflows** | Per-project states (e.g. *To do → In dev → Code review → QA → Done*) with colours, drag-to-reorder, WIP limits and delete-with-move; each state maps to a status category so reports, sprints and automations keep working |
| **Recurring tasks** | Daily, weekdays, weekly on chosen days, every N weeks/months, yearly, with an optional end date; completing an occurrence creates the next one (dates shifted, labels/assignee/estimate kept) exactly once |
| **Sprints** | Plan, start (one active per project), complete (unfinished work returns to the backlog) |
| **Time tracking** | One live timer per user (shown in the command bar), manual logs (“1h 30m”), weekly timesheet, estimate vs. logged |
| **Goals / OKRs** | Objectives with manual key results or ones computed from linked tasks; status and progress roll-up |
| **Docs** | Markdown pages per project or workspace, autosave, version-conflict detection, task keys auto-link, full-text search |
| **Automations** | *When → If → Then* rules (enters state, status/priority change, created, assigned, commented, overdue → move to state, set fields, assign, label, move sprint, comment, notify). Loop-safe |
| **Slack** | Channel notifications through an Incoming Webhook (Block Kit messages; pick events and an optional project) and a signed `/workora` slash command: `create [KEY:] title`, look up `ECOM-12`, search, help |
| **GitHub** | Repository webhook (HMAC-verified) links PRs, commits, branches and issues that mention a task key; PR opened/merged moves the task forward through the workflow, `fixes ECOM-12` on the default branch closes it, new issues can become tasks. Task sheets show a *Development* panel with copyable branch names; cards show open-PR badges |
| **Webhooks** | Outgoing webhooks with HMAC-SHA256 signatures, retries with backoff and a delivery log |
| **Notifications** | Mentions, assignments, watched-task changes, overdue reminders (recurring job), automation alerts: in-app (live) and Inbox page |
| **Email** | SMTP delivery (any provider, TLS/STARTTLS, auth, pooled) of branded HTML + plain-text emails via a retrying job queue; per-user preferences for 8 kinds of email; signed one-click unsubscribe (RFC 8058 `List-Unsubscribe`); admin status page with test send and delivery log |
| **Workspace** | Multi-tenant organizations, RBAC (Owner › Admin › Member › Viewer), teams, labels, favourites pinned to the dock |

**Platform**

| Area | Details |
|------|---------|
| **SPA** | Client-side routing under `/workora`, no full-page reloads; tasks open in a floating sheet via `?task=ECOM-102` |
| **Optimistic UI** | Board drags, property edits, comments and bulk edits update instantly and roll back on failure |
| **Real-time** | socket.io gateway (Redis adapter) — boards, sheets, docs, goals, notifications update live for every viewer |
| **Caching & loading** | TanStack Query stale-while-revalidate; lazy-loaded modules; skeletons and inline “Saving…” states |
| **Search** | Debounced global search + Ctrl K palette over tasks, projects, people, comments and docs (PostgreSQL FTS) |
| **API** | Versioned `/api/v1`, uniform `{ success, data, meta }` / `{ success, error }` envelope, OpenAPI at `/api/docs` |
| **Events & jobs** | Domain events after commit → activity log, notifications, realtime, automations, webhooks; BullMQ jobs |
| **Security** | JWT, tenant isolation, RBAC, Redis rate limiting, signed file URLs, webhook SSRF guard in production |

### UI: “Paper & Volt”

The interface deliberately avoids the usual sidebar-plus-cards template: a floating **ink dock** (favourite projects
appear as app icons), a glassy **command bar** with a live timer chip, a **bento** home with a Focus tile and a
completion heatmap, borderless floating surfaces on a dotted paper canvas, an electric-lime accent, Space Grotesk
display type, property **pills** with popover pickers, and a floating task **sheet**. Light and dark themes; on phones
the dock becomes a bottom tab bar.

### Connecting Slack and GitHub

Admins manage both under **Admin → Integrations**.

- **Slack:** create a Slack app, add an *Incoming Webhook* for a channel and paste its URL. For the slash
  command, add `/workora`, paste the app's *Signing Secret*, and set the command's Request URL to the one
  Workora shows (`/api/v1/hooks/slack/:id/commands`). Only `https://hooks.slack.com/` URLs are accepted.
- **GitHub:** connect a repository (or any repository) to get a *Payload URL* (`/api/v1/hooks/github/:id`)
  and a secret, shown once. Add them under the repo's *Settings → Webhooks* with content type
  `application/json` and the *Pull requests*, *Pushes* and *Issues* events. Workora must be reachable from
  GitHub/Slack (set `APP_URL` so links in Slack messages point at your deployment).

The demo seed connects `acme/storefront` with an open PR and commits linked to ECOM-3.

### Email notifications

Set SMTP on the API and restart it, either as a URL or as discrete variables:

```bash
SMTP_URL=smtp://apikey:secret@smtp.sendgrid.net:587     # smtps://…:465 for implicit TLS
MAIL_FROM="Workora <no-reply@yourcompany.com>"
APP_URL=https://workora.yourcompany.com/workora          # links in emails
# or SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_SECURE / SMTP_REQUIRE_TLS
```

Without SMTP settings, emails are rendered and logged but not sent. Admins can check the configuration
and send a test email under **Admin → Email**. Each person picks which emails they get under
**Settings** (user menu → Notification settings). By default they get assignments, @mentions, overdue
reminders, automation alerts and workspace invites. Comments, status changes and sprint emails are off
until the person turns them on. Every email carries a signed unsubscribe link, and a `List-Unsubscribe`
header so mail clients can show a one-click *Unsubscribe* button.

Not yet built: OAuth "Add to Slack"/GitHub App installs (setup uses webhooks and secrets), refresh tokens,
daily digest emails.

## Testing

```bash
cd workora-api && npm run test:e2e     # needs Postgres (workora_test db) + Redis
```

Six e2e suites (90 tests) cover the envelope and error codes, key-based lookup, PATCH semantics, board
ordering, RBAC, tenant isolation, websocket delivery, signed uploads, search, sprints, reports, labels,
epics/subtasks, dependencies, watchers, time tracking, goals, docs conflicts, automations (incl. loop
prevention), signed webhook deliveries, bulk edit, favourites, overdue reminders, custom workflows
(CRUD, reorder, category re-sync, delete-with-move, state automations), recurring tasks (rule maths,
spawning once, end dates) and Slack/GitHub (signatures and replay window, slash commands, event filtering,
PR lifecycle with forward-only moves, closing keywords, issues → tasks, repository filter) and email
(authenticated SMTP against a real test server, templates and escaping, preference defaults and opt-in/out,
signed and one-click unsubscribe, no retry on 5xx, retry on 4xx, admin status and test send).
The newest suite covers custom fields (types, validation, filters, option renames), trash (subtasks, every query
skips trashed tasks, restore into a deleted state, purge), saved views, burndown/velocity, workload allocation,
intake forms, CSV import/export and labels (rename clash, merge, bulk add/remove).

Browser-level checks (Playwright, against the seeded demo) cover the full UI flows as well: drag & drop,
realtime, workflows, recurrence, integrations, email, custom fields, saved views, board filters, CSV import and
export, trash with undo, workload, burndown, public forms on mobile, label merge, Explore, shortcuts and role
restrictions.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.
