import { MigrationInterface, QueryRunner } from 'typeorm';

/** Custom fields, saved views, intake forms, trash (soft delete) and member capacity. */
export class WorkManagementPlus1728000000000 implements MigrationInterface {
  name = 'WorkManagementPlus1728000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE custom_fields (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name varchar NOT NULL,
        type varchar NOT NULL,
        options jsonb NOT NULL DEFAULT '[]',
        position int NOT NULL DEFAULT 0,
        required boolean NOT NULL DEFAULT false,
        show_in_list boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_custom_fields_project ON custom_fields(project_id, position);

      ALTER TABLE tasks ADD COLUMN custom_values jsonb NOT NULL DEFAULT '{}';
      CREATE INDEX idx_tasks_custom_values ON tasks USING gin (custom_values);

      ALTER TABLE tasks ADD COLUMN deleted_at timestamptz;
      ALTER TABLE tasks ADD COLUMN deleted_by_id uuid REFERENCES users(id) ON DELETE SET NULL;
      CREATE INDEX idx_tasks_trash ON tasks(organization_id, deleted_at) WHERE deleted_at IS NOT NULL;

      CREATE TABLE saved_views (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name varchar NOT NULL,
        shared boolean NOT NULL DEFAULT false,
        config jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_saved_views_project ON saved_views(organization_id, project_id);

      CREATE TABLE forms (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        slug varchar NOT NULL UNIQUE,
        name varchar NOT NULL,
        description text NOT NULL DEFAULT '',
        questions jsonb NOT NULL DEFAULT '[]',
        defaults jsonb NOT NULL DEFAULT '{}',
        enabled boolean NOT NULL DEFAULT true,
        submission_count int NOT NULL DEFAULT 0,
        last_submitted_at timestamptz,
        created_by_id uuid NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_forms_project ON forms(project_id);

      ALTER TABLE memberships ADD COLUMN weekly_capacity_minutes int NOT NULL DEFAULT 2400;
      ALTER TABLE sprints ADD COLUMN completion_stats jsonb;
    `);
    // Trash: the real table becomes tasks_all and "tasks" is an auto-updatable view of live tasks,
    // so every existing query (including raw SQL and joins) skips trashed tasks without changes.
    // Foreign keys, indexes and constraints stay on the table. NOTE: a later migration that adds
    // columns to tasks_all must re-create this view (CREATE OR REPLACE VIEW tasks AS …).
    await q.query(`
      ALTER TABLE tasks RENAME TO tasks_all;
      CREATE VIEW tasks AS SELECT * FROM tasks_all WHERE deleted_at IS NULL;
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP VIEW tasks; ALTER TABLE tasks_all RENAME TO tasks;`);
    await q.query(`
      ALTER TABLE sprints DROP COLUMN completion_stats;
      ALTER TABLE memberships DROP COLUMN weekly_capacity_minutes;
      DROP TABLE forms; DROP TABLE saved_views;
      ALTER TABLE tasks DROP COLUMN deleted_by_id; ALTER TABLE tasks DROP COLUMN deleted_at; ALTER TABLE tasks DROP COLUMN custom_values;
      DROP TABLE custom_fields;
    `);
  }
}
