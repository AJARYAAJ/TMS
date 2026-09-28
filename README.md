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
docker compose up -d                      # PostgreSQL + Redis

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
| **Views** | Overview, List (filters + multi-select bulk edit), Board (drag & drop), Backlog, Sprint, Calendar, Timeline, Roadmap, Goals, Docs, Reports, Automations |
| **Sprints** | Plan, start (one active per project), complete (unfinished work returns to the backlog) |
| **Time tracking** | One live timer per user (shown in the command bar), manual logs (“1h 30m”), weekly timesheet, estimate vs. logged |
| **Goals / OKRs** | Objectives with manual key results or ones computed from linked tasks; status and progress roll-up |
| **Docs** | Markdown pages per project or workspace, autosave, version-conflict detection, task keys auto-link, full-text search |
| **Automations** | *When → If → Then* rules (status/priority change, created, assigned, commented, overdue → set fields, assign, label, move sprint, comment, notify). Loop-safe |
| **Integrations** | Outgoing webhooks with HMAC-SHA256 signatures, retries with backoff and a delivery log |
| **Notifications** | Mentions, assignments, watched-task changes, overdue reminders (recurring job), automation alerts: in-app (live), Inbox page, email queue |
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

Not yet built: third-party app integrations beyond webhooks (Slack/GitHub apps), custom workflow statuses,
recurring tasks, refresh tokens, SMTP transport (emails are logged).

## Testing

```bash
cd workora-api && npm run test:e2e     # needs Postgres (workora_test db) + Redis
```

Two e2e suites (25 tests) cover the envelope and error codes, key-based lookup, PATCH semantics, board
ordering, RBAC, tenant isolation, websocket delivery, signed uploads, search, sprints, reports, labels,
epics/subtasks, dependencies, watchers, time tracking, goals, docs conflicts, automations (incl. loop
prevention), signed webhook deliveries, bulk edit, favourites and overdue reminders.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.
