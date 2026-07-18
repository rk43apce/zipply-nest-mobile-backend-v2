import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerFcmToken1721200000000 implements MigrationInterface {
  name = 'AddCustomerFcmToken1721200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS fcm_token TEXT`);
    await q.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS device_platform VARCHAR(20)`);
    await q.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS fcm_token_updated_at TIMESTAMP`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE customers DROP COLUMN IF EXISTS fcm_token_updated_at`);
    await q.query(`ALTER TABLE customers DROP COLUMN IF EXISTS device_platform`);
    await q.query(`ALTER TABLE customers DROP COLUMN IF EXISTS fcm_token`);
  }
}
