import { MigrationInterface, QueryRunner } from 'typeorm';

/** TOTP two-factor authentication, an org-wide 2FA requirement, and OIDC single sign-on. */
export class TwoFactorAndSso1728200000000 implements MigrationInterface {
  name = 'TwoFactorAndSso1728200000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE users
        ADD COLUMN totp_secret varchar,
        ADD COLUMN totp_pending_secret varchar,
        ADD COLUMN totp_enabled_at timestamptz,
        ADD COLUMN totp_last_step bigint,
        ADD COLUMN recovery_codes jsonb NOT NULL DEFAULT '[]';

      ALTER TABLE organizations ADD COLUMN require_2fa boolean NOT NULL DEFAULT false;

      CREATE TABLE sso_connections (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
        provider_name varchar NOT NULL,
        issuer varchar NOT NULL,
        client_id varchar NOT NULL,
        client_secret varchar NOT NULL,
        domains jsonb NOT NULL DEFAULT '[]',
        auto_provision boolean NOT NULL DEFAULT true,
        default_role varchar NOT NULL DEFAULT 'MEMBER',
        enforce boolean NOT NULL DEFAULT false,
        enabled boolean NOT NULL DEFAULT true,
        last_login_at timestamptz,
        last_error varchar,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE user_identities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        connection_id uuid NOT NULL REFERENCES sso_connections(id) ON DELETE CASCADE,
        subject varchar NOT NULL,
        email varchar NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_login_at timestamptz,
        UNIQUE (connection_id, subject)
      );
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE user_identities; DROP TABLE sso_connections;
      ALTER TABLE organizations DROP COLUMN require_2fa;
      ALTER TABLE users DROP COLUMN recovery_codes, DROP COLUMN totp_last_step, DROP COLUMN totp_enabled_at, DROP COLUMN totp_pending_secret, DROP COLUMN totp_secret;
    `);
  }
}
