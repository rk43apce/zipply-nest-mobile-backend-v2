import { MigrationInterface, QueryRunner } from 'typeorm';

export class PhaseOneScaleIndexes1720100000000 implements MigrationInterface {
  name = 'PhaseOneScaleIndexes1720100000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(80)`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id, created_at DESC)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_order_dispatches_order_id ON order_dispatches(order_id)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_dispatch_status_city_started ON order_dispatches(status, city, started_at DESC)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_dispatch_rider_status_started ON order_dispatches(assigned_rider_id, status, started_at DESC)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_offers_rider_status_expires ON dispatch_offers(rider_id, status, expires_at)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_offers_order_status ON dispatch_offers(order_id, status)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_earnings_rider_earned ON rider_earnings(rider_id, earned_at DESC)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_wallet_txn_wallet_created ON wallet_transactions(wallet_id, created_at DESC)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_wallet_txn_wallet_created`);
    await q.query(`DROP INDEX IF EXISTS idx_earnings_rider_earned`);
    await q.query(`DROP INDEX IF EXISTS idx_offers_order_status`);
    await q.query(`DROP INDEX IF EXISTS idx_offers_rider_status_expires`);
    await q.query(`DROP INDEX IF EXISTS idx_dispatch_rider_status_started`);
    await q.query(`DROP INDEX IF EXISTS idx_dispatch_status_city_started`);
    await q.query(`DROP INDEX IF EXISTS idx_order_dispatches_order_id`);
    await q.query(`DROP INDEX IF EXISTS idx_orders_status_created`);
    await q.query(`DROP INDEX IF EXISTS idx_orders_customer_created`);
    await q.query(`DROP INDEX IF EXISTS idx_orders_idempotency_key`);
    await q.query(`ALTER TABLE orders DROP COLUMN IF EXISTS idempotency_key`);
  }
}
