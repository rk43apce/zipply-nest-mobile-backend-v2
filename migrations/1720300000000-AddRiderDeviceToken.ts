import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRiderDeviceToken1720300000000 implements MigrationInterface {
  name = 'AddRiderDeviceToken1720300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE riders ADD COLUMN IF NOT EXISTS fcm_token TEXT`);
    await q.query(`ALTER TABLE riders ADD COLUMN IF NOT EXISTS device_platform VARCHAR(20)`);
    await q.query(`ALTER TABLE riders ADD COLUMN IF NOT EXISTS app_type VARCHAR(20)`);
    await q.query(`ALTER TABLE riders ADD COLUMN IF NOT EXISTS device_id VARCHAR(100)`);
    await q.query(`ALTER TABLE riders ADD COLUMN IF NOT EXISTS device_token_updated_at TIMESTAMP`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE riders DROP COLUMN IF EXISTS device_token_updated_at`);
    await q.query(`ALTER TABLE riders DROP COLUMN IF EXISTS device_id`);
    await q.query(`ALTER TABLE riders DROP COLUMN IF EXISTS app_type`);
    await q.query(`ALTER TABLE riders DROP COLUMN IF EXISTS device_platform`);
    await q.query(`ALTER TABLE riders DROP COLUMN IF EXISTS fcm_token`);
  }
}
