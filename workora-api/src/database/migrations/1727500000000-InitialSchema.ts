import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1727500000000 implements MigrationInterface {
  name = 'InitialSchema1727500000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email varchar NOT NULL UNIQUE,
        name varchar NOT NULL,
        password_hash varchar NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE organizations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL,
        slug varchar NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE memberships (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role varchar NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (organization_id, user_id)
      );
      CREATE INDEX idx_memberships_user ON memberships(user_id);

      CREATE TABLE teams (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name varchar NOT NULL,
        description text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_teams_org ON teams(organization_id);

      CREATE TABLE team_members (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE (team_id, user_id)
      );

      CREATE TABLE projects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        key varchar NOT NULL,
        name varchar NOT NULL,
        description text NOT NULL DEFAULT '',
        status varchar NOT NULL DEFAULT 'ACTIVE',
        color varchar NOT NULL DEFAULT '#6366f1',
        owner_id uuid NOT NULL REFERENCES users(id),
        task_seq integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (organization_id, key)
      );

      CREATE TABLE sprints (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name varchar NOT NULL,
        goal text NOT NULL DEFAULT '',
        status varchar NOT NULL DEFAULT 'PLANNED',
        start_date date,
        end_date date,
        completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_sprints_project ON sprints(project_id);
      CREATE UNIQUE INDEX uq_sprints_one_active ON sprints(project_id) WHERE status = 'ACTIVE';

      CREATE TABLE tasks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        number integer NOT NULL,
        key varchar NOT NULL,
        title varchar NOT NULL,
        description text NOT NULL DEFAULT '',
        type varchar NOT NULL DEFAULT 'TASK',
        status varchar NOT NULL DEFAULT 'TODO',
        priority varchar NOT NULL DEFAULT 'MEDIUM',
        position integer NOT NULL DEFAULT 0,
        assignee_id uuid REFERENCES users(id) ON DELETE SET NULL,
        reporter_id uuid NOT NULL REFERENCES users(id),
        sprint_id uuid REFERENCES sprints(id) ON DELETE SET NULL,
        story_points integer,
        start_date date,
        due_date date,
        completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        UNIQUE (organization_id, key),
        UNIQUE (project_id, number)
      );
      CREATE INDEX idx_tasks_board ON tasks(project_id, status, position);
      CREATE INDEX idx_tasks_assignee ON tasks(organization_id, assignee_id);
      CREATE INDEX idx_tasks_sprint ON tasks(sprint_id);
      CREATE INDEX idx_tasks_fts ON tasks USING gin (to_tsvector('simple', title || ' ' || description));

      CREATE TABLE comments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        author_id uuid NOT NULL REFERENCES users(id),
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_comments_task ON comments(task_id, created_at);
      CREATE INDEX idx_comments_fts ON comments USING gin (to_tsvector('simple', body));

      CREATE TABLE attachments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        uploader_id uuid NOT NULL REFERENCES users(id),
        file_name varchar NOT NULL,
        content_type varchar NOT NULL,
        size integer NOT NULL,
        storage_key varchar NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_attachments_task ON attachments(task_id);

      CREATE TABLE activities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id uuid,
        task_id uuid,
        actor_id uuid,
        actor_name varchar,
        type varchar NOT NULL,
        summary text NOT NULL,
        data jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_activities_org ON activities(organization_id, created_at DESC);
      CREATE INDEX idx_activities_project ON activities(project_id, created_at DESC);
      CREATE INDEX idx_activities_task ON activities(task_id, created_at DESC);

      CREATE TABLE notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_id uuid,
        actor_name varchar,
        type varchar NOT NULL,
        title varchar NOT NULL,
        body text NOT NULL DEFAULT '',
        project_id uuid,
        task_id uuid,
        task_key varchar,
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_notifications_user ON notifications(organization_id, user_id, created_at DESC);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE IF EXISTS notifications, activities, attachments, comments, tasks, sprints,
        projects, team_members, teams, memberships, organizations, users CASCADE;
    `);
  }
}
