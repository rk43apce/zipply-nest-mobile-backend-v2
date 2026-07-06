import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTopupLimitTrackerTable1720800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create topup_limits_tracker table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS topup_limits_tracker (
        id BIGSERIAL PRIMARY KEY,
        wallet_id BIGINT NOT NULL REFERENCES wallets(id),
        period_type VARCHAR(10) NOT NULL CHECK (period_type IN ('daily', 'monthly')),
        period_key VARCHAR(10) NOT NULL,
        total_amount BIGINT NOT NULL DEFAULT 0,
        txn_count INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (wallet_id, period_type, period_key)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_tlt_wallet 
      ON topup_limits_tracker(wallet_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_tlt_period 
      ON topup_limits_tracker(wallet_id, period_type, period_key)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS topup_limits_tracker CASCADE`);
  }
}
