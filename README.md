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

| Area | Details |
|------|---------|
| **SPA** | Client-side routing (`/workora/projects/ECOM/board` …), no full-page reloads anywhere in the normal workflow |
| **Task drawer** | Tasks open over the current screen via `?task=ECOM-102` (shareable, back-button friendly); inline editing, comments with @mentions, attachments, activity |
| **Views** | Dashboard, My Work, Projects, project Overview / List / Board / Calendar / Timeline / Backlog / Sprint / Reports, Teams, Administration |
| **Drag & drop** | Kanban with optimistic moves, rollback + “Couldn't move task. Please try again.” on failure |
| **Real-time** | socket.io gateway; board, drawer, notifications and dashboards update live for every viewer |
| **Caching** | TanStack Query stale-while-revalidate; drawer/project headers render instantly from cached lists |
| **Lazy loading** | Everything except the app shell, auth and dashboard is code-split per module |
| **Loading UX** | Skeletons, inline “Saving…”, no full-screen spinners |
| **Search** | Debounced global search + Ctrl K palette, backed by PostgreSQL full-text search (GIN indexes) |
| **API** | Versioned `/api/v1`, uniform `{ success, data, meta }` / `{ success, error: { code, message } }` envelope, OpenAPI docs |
| **Security** | JWT auth, organization-scoped data (multi-tenant), RBAC (Owner › Admin › Member › Viewer), Redis-backed rate limiting |
| **Events** | Domain events (`TASK_UPDATED`, `COMMENT_CREATED`, `SPRINT_STARTED`…) published after commit and consumed by activity log, notifications, realtime relay and job scheduler |
| **Background jobs** | BullMQ: project setup (default sprint), email delivery for notifications |
| **Files** | Signed-URL uploads/downloads (local disk driver; swap for S3/GCS presigned URLs) |

Not yet built: Goals and Documents modules (routes and navigation are in place), automations,
third-party integrations, refresh tokens, SMTP transport (emails are logged).

## Testing

```bash
cd workora-api && npm run test:e2e     # needs Postgres (workora_test db) + Redis
```

The e2e suite covers the envelope and error codes, key-based task lookup, PATCH semantics, board
ordering, RBAC, tenant isolation, mentions → notifications, websocket delivery, signed uploads,
full-text search, sprints and reports.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.
