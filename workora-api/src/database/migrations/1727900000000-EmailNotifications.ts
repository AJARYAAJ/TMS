import { MigrationInterface, QueryRunner } from 'typeorm';

/** Per-user email preferences and a log of notification email deliveries. */
export class EmailNotifications1727900000000 implements MigrationInterface {
  name = 'EmailNotifications1727900000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE users ADD COLUMN email_prefs jsonb NOT NULL DEFAULT '{}';

      CREATE TABLE email_deliveries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
        user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        recipient varchar NOT NULL,
        category varchar NOT NULL,
        subject varchar NOT NULL,
        status varchar NOT NULL,
        error varchar,
        message_id varchar,
        attempts int NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_email_deliveries_org ON email_deliveries(organization_id, created_at DESC);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE email_deliveries; ALTER TABLE users DROP COLUMN email_prefs;`);
  }
}
