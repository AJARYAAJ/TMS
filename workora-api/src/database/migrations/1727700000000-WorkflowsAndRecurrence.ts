import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Custom per-project workflow states (each mapped to a status category) and recurring tasks.
 * Existing projects get the four default states and tasks are backfilled onto them.
 */
export class WorkflowsAndRecurrence1727700000000 implements MigrationInterface {
  name = 'WorkflowsAndRecurrence1727700000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE workflow_states (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name varchar NOT NULL,
        category varchar NOT NULL,
        color varchar NOT NULL DEFAULT '#9a968b',
        position integer NOT NULL DEFAULT 0,
        wip_limit integer,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX uq_workflow_state_name ON workflow_states(project_id, lower(name));
      CREATE INDEX idx_workflow_states_project ON workflow_states(project_id, position);

      INSERT INTO workflow_states (organization_id, project_id, name, category, color, position)
      SELECT p.organization_id, p.id, s.name, s.category, s.color, s.pos
        FROM projects p
        CROSS JOIN (VALUES ('To do', 'TODO', '#9a968b', 0), ('In progress', 'IN_PROGRESS', '#3b82f6', 1),
                           ('In review', 'IN_REVIEW', '#a855f7', 2), ('Done', 'DONE', '#16a34a', 3)) AS s(name, category, color, pos);

      ALTER TABLE tasks ADD COLUMN state_id uuid REFERENCES workflow_states(id);
      UPDATE tasks t SET state_id = ws.id FROM workflow_states ws WHERE ws.project_id = t.project_id AND ws.category = t.status;
      ALTER TABLE tasks ALTER COLUMN state_id SET NOT NULL;
      CREATE INDEX idx_tasks_state ON tasks(state_id, position);

      ALTER TABLE tasks ADD COLUMN recurrence jsonb;
      ALTER TABLE tasks ADD COLUMN series_id uuid;
      ALTER TABLE tasks ADD COLUMN recurrence_spawned_at timestamptz;
      CREATE INDEX idx_tasks_series ON tasks(series_id);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE tasks DROP COLUMN IF EXISTS recurrence, DROP COLUMN IF EXISTS series_id,
        DROP COLUMN IF EXISTS recurrence_spawned_at, DROP COLUMN IF EXISTS state_id;
      DROP TABLE IF EXISTS workflow_states;
    `);
  }
}
