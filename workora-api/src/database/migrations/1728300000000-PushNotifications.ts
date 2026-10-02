import { MigrationInterface, QueryRunner } from 'typeorm';

/** Desktop (Web Push) notifications, notification categories and links, and due-date reminders. */
export class PushNotifications1728300000000 implements MigrationInterface {
  name = 'PushNotifications1728300000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE users ADD COLUMN push_prefs jsonb NOT NULL DEFAULT '{}';

      ALTER TABLE notifications
        ADD COLUMN category varchar,
        ADD COLUMN link varchar;

      CREATE TABLE push_subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint text NOT NULL UNIQUE,
        p256dh varchar NOT NULL,
        auth varchar NOT NULL,
        device varchar NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        last_success_at timestamptz,
        failures int NOT NULL DEFAULT 0
      );
      CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

      -- Server-wide secrets generated on first use (the VAPID key pair), sealed with SecretBox.
      CREATE TABLE app_secrets (
        name varchar PRIMARY KEY,
        value text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      -- One reminder per task, kind and due date: changing the due date re-arms it.
      CREATE TABLE task_reminders (
        task_id uuid NOT NULL REFERENCES tasks_all(id) ON DELETE CASCADE,
        kind varchar NOT NULL,
        due_date date NOT NULL,
        sent_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (task_id, kind, due_date)
      );
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE task_reminders;
      DROP TABLE app_secrets;
      DROP TABLE push_subscriptions;
      ALTER TABLE notifications DROP COLUMN link, DROP COLUMN category;
      ALTER TABLE users DROP COLUMN push_prefs;
    `);
  }
}
