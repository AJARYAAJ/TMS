import { MigrationInterface, QueryRunner } from 'typeorm';

/** First-party integrations (Slack, GitHub) and links from tasks to external artefacts (PRs, commits, issues). */
export class SlackGithubIntegrations1727800000000 implements MigrationInterface {
  name = 'SlackGithubIntegrations1727800000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE integrations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        provider varchar NOT NULL,
        name varchar NOT NULL,
        config jsonb NOT NULL DEFAULT '{}',
        secret varchar,
        enabled boolean NOT NULL DEFAULT true,
        created_by_id uuid NOT NULL REFERENCES users(id),
        last_status varchar,
        last_error varchar,
        last_activity_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_integrations_org ON integrations(organization_id, provider) WHERE enabled;

      CREATE TABLE external_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        provider varchar NOT NULL,
        kind varchar NOT NULL,
        external_id varchar NOT NULL,
        url varchar NOT NULL,
        title varchar NOT NULL,
        state varchar,
        author varchar,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (task_id, provider, kind, external_id)
      );
      CREATE INDEX idx_external_links_task ON external_links(task_id);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS external_links, integrations;');
  }
}
