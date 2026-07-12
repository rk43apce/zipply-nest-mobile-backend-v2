import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTopupLimitTrackerTable1720800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // The table was already created by migration 1720000000000 with columns:
    //   id UUID, wallet_id UUID, period_type, period_start DATE, amount_used INT
    // This migration aligns it to the new schema by adding missing columns.

    // Add period_key column (replaces period_start for string-based keys like '2025-07-09')
    await queryRunner.query(`
      ALTER TABLE topup_limits_tracker 
      ADD COLUMN IF NOT EXISTS period_key VARCHAR(10)
    `);

    // Backfill period_key from period_start if data exists
    await queryRunner.query(`
      UPDATE topup_limits_tracker 
      SET period_key = TO_CHAR(period_start, 'YYYY-MM-DD') 
      WHERE period_key IS NULL AND period_start IS NOT NULL
    `);

    // Add total_amount column (replaces amount_used)
    await queryRunner.query(`
      ALTER TABLE topup_limits_tracker 
      ADD COLUMN IF NOT EXISTS total_amount BIGINT NOT NULL DEFAULT 0
    `);

    // Backfill total_amount from amount_used if data exists
    await queryRunner.query(`
      UPDATE topup_limits_tracker 
      SET total_amount = COALESCE(amount_used, 0) 
      WHERE total_amount = 0 AND amount_used IS NOT NULL AND amount_used > 0
    `);

    // Add txn_count column
    await queryRunner.query(`
      ALTER TABLE topup_limits_tracker 
      ADD COLUMN IF NOT EXISTS txn_count INT NOT NULL DEFAULT 0
    `);

    // Add updated_at column
    await queryRunner.query(`
      ALTER TABLE topup_limits_tracker 
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);

    // Create indexes
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
    await queryRunner.query(`DROP INDEX IF EXISTS idx_tlt_period`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_tlt_wallet`);
    await queryRunner.query(`ALTER TABLE topup_limits_tracker DROP COLUMN IF EXISTS updated_at`);
    await queryRunner.query(`ALTER TABLE topup_limits_tracker DROP COLUMN IF EXISTS txn_count`);
    await queryRunner.query(`ALTER TABLE topup_limits_tracker DROP COLUMN IF EXISTS total_amount`);
    await queryRunner.query(`ALTER TABLE topup_limits_tracker DROP COLUMN IF EXISTS period_key`);
  }
}
