import { MigrationInterface, QueryRunner } from 'typeorm';

/** Epics/subtasks, labels, watchers, dependencies, time tracking, goals, docs, automations, webhooks, favorites. */
export class WorkManagementExtensions1727600000000 implements MigrationInterface {
  name = 'WorkManagementExtensions1727600000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE tasks ADD COLUMN parent_id uuid REFERENCES tasks(id) ON DELETE SET NULL;
      ALTER TABLE tasks ADD COLUMN estimate_minutes integer;
      ALTER TABLE tasks ADD COLUMN overdue_notified_at timestamptz;
      CREATE INDEX idx_tasks_parent ON tasks(parent_id);
      CREATE INDEX idx_tasks_due ON tasks(due_date) WHERE status <> 'DONE';

      CREATE TABLE labels (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name varchar NOT NULL,
        color varchar NOT NULL DEFAULT '#6366f1',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX uq_labels_name ON labels(organization_id, lower(name));

      CREATE TABLE task_labels (
        task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        label_id uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, label_id)
      );
      CREATE INDEX idx_task_labels_label ON task_labels(label_id);

      CREATE TABLE task_watchers (
        task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (task_id, user_id)
      );

      CREATE TABLE task_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        source_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        target_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        type varchar NOT NULL,
        created_by_id uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (source_task_id, target_task_id, type),
        CHECK (source_task_id <> target_task_id)
      );
      CREATE INDEX idx_task_links_target ON task_links(target_task_id);

      CREATE TABLE time_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        started_at timestamptz NOT NULL,
        ended_at timestamptz,
        minutes integer,
        note text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_time_entries_user ON time_entries(user_id, started_at DESC);
      CREATE INDEX idx_time_entries_task ON time_entries(task_id);
      CREATE UNIQUE INDEX uq_time_entries_running ON time_entries(user_id) WHERE ended_at IS NULL;

      CREATE TABLE goals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
        owner_id uuid NOT NULL REFERENCES users(id),
        title varchar NOT NULL,
        description text NOT NULL DEFAULT '',
        status varchar NOT NULL DEFAULT 'ON_TRACK',
        due_date date,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_goals_org ON goals(organization_id);

      CREATE TABLE key_results (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        goal_id uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        title varchar NOT NULL,
        kind varchar NOT NULL DEFAULT 'NUMBER',
        start_value numeric NOT NULL DEFAULT 0,
        target_value numeric NOT NULL DEFAULT 100,
        current_value numeric NOT NULL DEFAULT 0,
        unit varchar NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE goal_tasks (
        goal_id uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        PRIMARY KEY (goal_id, task_id)
      );

      CREATE TABLE documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
        title varchar NOT NULL,
        icon varchar NOT NULL DEFAULT '📄',
        content text NOT NULL DEFAULT '',
        author_id uuid NOT NULL REFERENCES users(id),
        updated_by_id uuid REFERENCES users(id),
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_documents_project ON documents(organization_id, project_id);
      CREATE INDEX idx_documents_fts ON documents USING gin (to_tsvector('simple', title || ' ' || content));

      CREATE TABLE automations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name varchar NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        trigger jsonb NOT NULL,
        conditions jsonb NOT NULL DEFAULT '{}',
        actions jsonb NOT NULL,
        run_count integer NOT NULL DEFAULT 0,
        last_run_at timestamptz,
        created_by_id uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_automations_project ON automations(project_id) WHERE enabled;

      CREATE TABLE webhooks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name varchar NOT NULL,
        url varchar NOT NULL,
        secret varchar NOT NULL,
        events jsonb NOT NULL DEFAULT '["*"]',
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE webhook_deliveries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        webhook_id uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
        event_id uuid NOT NULL,
        event_type varchar NOT NULL,
        attempt integer NOT NULL,
        status_code integer,
        success boolean NOT NULL,
        duration_ms integer NOT NULL,
        error varchar,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_webhook_deliveries ON webhook_deliveries(webhook_id, created_at DESC);

      CREATE TABLE favorites (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, project_id)
      );
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE IF EXISTS favorites, webhook_deliveries, webhooks, automations, documents, goal_tasks,
        key_results, goals, time_entries, task_links, task_watchers, task_labels, labels CASCADE;
      ALTER TABLE tasks DROP COLUMN IF EXISTS parent_id, DROP COLUMN IF EXISTS estimate_minutes, DROP COLUMN IF EXISTS overdue_notified_at;
    `);
  }
}
