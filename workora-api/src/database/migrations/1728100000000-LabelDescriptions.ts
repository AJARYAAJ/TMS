import { MigrationInterface, QueryRunner } from 'typeorm';

/** Labels get an optional description ("what is this label for?"). */
export class LabelDescriptions1728100000000 implements MigrationInterface {
  name = 'LabelDescriptions1728100000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE labels ADD COLUMN description varchar(200) NOT NULL DEFAULT ''`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE labels DROP COLUMN description`);
  }
}
