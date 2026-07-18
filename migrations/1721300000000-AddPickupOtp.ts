import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPickupOtp1721300000000 implements MigrationInterface {
  name = 'AddPickupOtp1721300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_otp VARCHAR(6)`);
    await q.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_otp_verified_at TIMESTAMP`);
    await q.query(`ALTER TABLE order_dispatches ADD COLUMN IF NOT EXISTS pickup_otp VARCHAR(6)`);
    await q.query(`ALTER TABLE order_dispatches ADD COLUMN IF NOT EXISTS pickup_otp_verified_at TIMESTAMP`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE order_dispatches DROP COLUMN IF EXISTS pickup_otp_verified_at`);
    await q.query(`ALTER TABLE order_dispatches DROP COLUMN IF EXISTS pickup_otp`);
    await q.query(`ALTER TABLE orders DROP COLUMN IF EXISTS pickup_otp_verified_at`);
    await q.query(`ALTER TABLE orders DROP COLUMN IF EXISTS pickup_otp`);
  }
}
