import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignWalletTransactionsSchema1720900000000 implements MigrationInterface {
  name = 'AlignWalletTransactionsSchema1720900000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64)`);
    await q.query(`UPDATE wallet_transactions SET idempotency_key = 'legacy_' || id::text WHERE idempotency_key IS NULL`);
    await q.query(`ALTER TABLE wallet_transactions ALTER COLUMN idempotency_key SET NOT NULL`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_transactions_idempotency_key ON wallet_transactions(idempotency_key)`);
    await q.query(`ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS metadata JSONB`);
    await q.query(`ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP`);
    await q.query(`ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_txn_category_check`);
    await q.query(`ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_txn_category_check CHECK (txn_category IN ('topup', 'purchase', 'order_payment', 'hold_capture', 'hold_release', 'refund', 'reversal', 'cancellation_fee', 'bonus', 'expiry'))`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_txn_category_check`);
    await q.query(`ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_txn_category_check CHECK (txn_category IN ('topup', 'order_payment', 'hold_capture', 'refund', 'cancellation_fee', 'bonus'))`);
    await q.query(`DROP INDEX IF EXISTS idx_wallet_transactions_idempotency_key`);
    await q.query(`ALTER TABLE wallet_transactions DROP COLUMN IF EXISTS completed_at`);
    await q.query(`ALTER TABLE wallet_transactions DROP COLUMN IF EXISTS metadata`);
    await q.query(`ALTER TABLE wallet_transactions DROP COLUMN IF EXISTS idempotency_key`);
  }
}
