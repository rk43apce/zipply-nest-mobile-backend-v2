import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRiderLocationAccuracyTimestamp1720200000000 implements MigrationInterface {
  name = 'AddRiderLocationAccuracyTimestamp1720200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE rider_locations ADD COLUMN IF NOT EXISTS accuracy DECIMAL(7,2)`);
    await q.query(`ALTER TABLE rider_locations ADD COLUMN IF NOT EXISTS gps_timestamp TIMESTAMP`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE rider_locations DROP COLUMN IF EXISTS gps_timestamp`);
    await q.query(`ALTER TABLE rider_locations DROP COLUMN IF EXISTS accuracy`);
  }
}
