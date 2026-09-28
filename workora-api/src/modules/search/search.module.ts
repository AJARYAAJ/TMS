import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';

/** Turns free text into a prefix-matching tsquery: "payment ap" -> "payment:* & ap:*". */
export function toPrefixTsQuery(q: string) {
  const terms = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return terms.slice(0, 8).map((t) => `${t}:*`).join(' & ');
}

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Global search across tasks, projects, people and comments using PostgreSQL full-text
 * search (GIN indexes). The same contract can later be served by OpenSearch.
 */
@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async search(@CurrentUser() u: AuthPrincipal, @Query('q') raw = '', @Query('limit') limitRaw?: string) {
    const q = raw.trim().slice(0, 200);
    const limit = Math.min(Math.max(Number(limitRaw) || 5, 1), 25);
    if (q.length < 2) return { query: q, tasks: [], projects: [], users: [], comments: [], documents: [] };
    const ts = toPrefixTsQuery(q);
    const org = u.organizationId;
    const db = this.dataSource;

    const [tasks, projects, users, comments, documents] = await Promise.all([
      db.query(
        `SELECT t.id, t.key, t.title, t.status, t.priority, t.project_id AS "projectId", p.name AS "projectName"
           FROM tasks t JOIN projects p ON p.id = t.project_id
          WHERE t.organization_id = $1
            AND (t.key ILIKE $2 OR ($3 <> '' AND to_tsvector('simple', t.title || ' ' || t.description) @@ to_tsquery('simple', $3)))
          ORDER BY (t.key ILIKE $2) DESC,
                   CASE WHEN $3 <> '' THEN ts_rank(to_tsvector('simple', t.title || ' ' || t.description), to_tsquery('simple', $3)) ELSE 0 END DESC,
                   t.updated_at DESC
          LIMIT $4`,
        [org, like(q), ts, limit],
      ),
      db.query(
        `SELECT id, key, name, color, status FROM projects
          WHERE organization_id = $1 AND (name ILIKE $2 OR key ILIKE $2)
          ORDER BY name LIMIT $3`,
        [org, like(q), limit],
      ),
      db.query(
        `SELECT u.id, u.name, u.email, m.role FROM users u JOIN memberships m ON m.user_id = u.id
          WHERE m.organization_id = $1 AND (u.name ILIKE $2 OR u.email ILIKE $2)
          ORDER BY u.name LIMIT $3`,
        [org, like(q), limit],
      ),
      ts
        ? db.query(
            `SELECT c.id, c.task_id AS "taskId", t.key AS "taskKey", t.project_id AS "projectId", left(c.body, 200) AS snippet, c.created_at AS "createdAt"
               FROM comments c JOIN tasks t ON t.id = c.task_id
              WHERE c.organization_id = $1 AND to_tsvector('simple', c.body) @@ to_tsquery('simple', $2)
              ORDER BY ts_rank(to_tsvector('simple', c.body), to_tsquery('simple', $2)) DESC, c.created_at DESC
              LIMIT $3`,
            [org, ts, limit],
          )
        : [],
      db.query(
        `SELECT d.id, d.title, d.icon, d.project_id AS "projectId", left(regexp_replace(d.content, '\s+', ' ', 'g'), 160) AS snippet
           FROM documents d
          WHERE d.organization_id = $1
            AND (d.title ILIKE $2 OR ($3 <> '' AND to_tsvector('simple', d.title || ' ' || d.content) @@ to_tsquery('simple', $3)))
          ORDER BY (d.title ILIKE $2) DESC, d.updated_at DESC
          LIMIT $4`,
        [org, like(q), ts, limit],
      ),
    ]);
    return { query: q, tasks, projects, users, comments, documents };
  }
}

@Module({ controllers: [SearchController] })
export class SearchModule {}
