import { MigrationInterface, QueryRunner } from "typeorm";

export class WalletSystemTables1720400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create transaction_links table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS transaction_links (
        id BIGSERIAL PRIMARY KEY,
        payment_txn_id BIGINT NOT NULL,
        wallet_txn_id BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (payment_txn_id, wallet_txn_id)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_tl_payment_wallet ON transaction_links(payment_txn_id, wallet_txn_id)`);

    // Create wallet_audit_log table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS wallet_audit_log (
        id BIGSERIAL PRIMARY KEY,
        wallet_id BIGINT NOT NULL,
        actor_type VARCHAR(20) NOT NULL CHECK (actor_type IN ('user', 'system', 'admin', 'gateway_webhook')),
        actor_id VARCHAR(64) NULL,
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id BIGINT NOT NULL,
        old_state JSONB NULL,
        new_state JSONB NULL,
        ip_address VARCHAR(45) NULL,
        user_agent VARCHAR(500) NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_wal_wallet_time ON wallet_audit_log(wallet_id, created_at DESC)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_wal_action ON wallet_audit_log(action)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_wal_entity ON wallet_audit_log(entity_type, entity_id)`);

    // Create refund_requests table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS refund_requests (
        id BIGSERIAL PRIMARY KEY,
        wallet_id BIGINT NOT NULL,
        original_payment_txn_id BIGINT NOT NULL,
        wallet_txn_id BIGINT NULL,
        refund_amount BIGINT NOT NULL CHECK (refund_amount > 0),
        reason TEXT NOT NULL,
        status VARCHAR(15) NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'processing', 'completed', 'failed')),
        gateway_refund_id VARCHAR(128) NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ NULL
      )
    `);

    // Create commission_ledger table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS commission_ledger (
        id BIGSERIAL PRIMARY KEY,
        trip_payment_id BIGINT NOT NULL UNIQUE,
        rider_id BIGINT NOT NULL,
        rider_wallet_id BIGINT NOT NULL,
        commission_amount BIGINT NOT NULL CHECK (commission_amount > 0),
        commission_type VARCHAR(15) NOT NULL CHECK (commission_type IN ('percentage', 'fixed', 'tiered')),
        commission_rate INT NULL,
        fare_basis BIGINT NOT NULL,
        wallet_txn_id BIGINT NULL,
        status VARCHAR(15) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'deducted', 'waived', 'reversed')),
        idempotency_key VARCHAR(64) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deducted_at TIMESTAMPTZ NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_cl_rider ON commission_ledger(rider_id, status)`);

    // Create business_rules table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS business_rules (
        id BIGSERIAL PRIMARY KEY,
        rule_key VARCHAR(100) NOT NULL UNIQUE,
        rule_value TEXT NOT NULL,
        value_type VARCHAR(10) NOT NULL DEFAULT 'string' CHECK (value_type IN ('int', 'string', 'json', 'boolean')),
        effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        effective_to TIMESTAMPTZ NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by VARCHAR(64) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_br_key_active ON business_rules(rule_key, is_active, effective_from)`);

    // Create fraud_flags table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fraud_flags (
        id BIGSERIAL PRIMARY KEY,
        wallet_id BIGINT NULL,
        user_id BIGINT NOT NULL,
        user_type VARCHAR(10) NOT NULL CHECK (user_type IN ('customer', 'rider')),
        flag_type VARCHAR(30) NOT NULL CHECK (flag_type IN ('velocity_breach', 'excessive_cash_trips', 'pattern_anomaly', 'manual')),
        severity VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
        description TEXT NOT NULL,
        status VARCHAR(15) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'dismissed')),
        resolved_by VARCHAR(64) NULL,
        resolved_at TIMESTAMPTZ NULL,
        resolution_notes TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_ff_user ON fraud_flags(user_id, user_type)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_ff_status ON fraud_flags(status, severity)`);

    // Create device_fingerprints table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS device_fingerprints (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        user_type VARCHAR(10) NOT NULL CHECK (user_type IN ('customer', 'rider')),
        device_id VARCHAR(255) NOT NULL,
        device_hash VARCHAR(64) NOT NULL,
        device_meta JSONB NULL,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
        flagged_reason VARCHAR(255) NULL,
        UNIQUE (user_id, user_type, device_hash)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_df_device_hash ON device_fingerprints(device_hash)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_df_user ON device_fingerprints(user_id, user_type)`);

    // Update wallets table if needed
    await queryRunner.query(`
      ALTER TABLE wallets
      ADD COLUMN IF NOT EXISTS kyc_level VARCHAR(10) DEFAULT 'basic' CHECK (kyc_level IN ('basic', 'full')),
      ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ NULL
    `);

    // Seed initial business rules (skip duplicates)
    await queryRunner.query(`
      INSERT INTO business_rules (rule_key, rule_value, value_type, created_by) VALUES
      ('rider_negative_balance_threshold', '-10000', 'int', 'system'),
      ('rider_hard_cap', '-50000', 'int', 'system'),
      ('commission_type', 'percentage', 'string', 'system'),
      ('commission_rate', '2000', 'int', 'system'),
      ('min_topup_amount', '100', 'int', 'system'),
      ('max_wallet_balance', '100000000', 'int', 'system'),
      ('min_withdrawal_amount', '1000', 'int', 'system'),
      ('max_daily_withdrawal', '5000000', 'int', 'system'),
      ('withdrawal_cooling_period_minutes', '30', 'int', 'system'),
      ('velocity_check_window_seconds', '60', 'int', 'system'),
      ('velocity_check_max_transactions', '5', 'int', 'system'),
      ('optimistic_lock_max_retries', '3', 'int', 'system'),
      ('cash_confirm_timeout_minutes', '15', 'int', 'system'),
      ('hold_expiry_minutes', '30', 'int', 'system')
      ON CONFLICT (rule_key) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse order of creation
    await queryRunner.query(`DROP TABLE IF EXISTS transaction_links CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS wallet_audit_log CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS refund_requests CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS commission_ledger CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS business_rules CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS fraud_flags CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS device_fingerprints CASCADE`);
  }
}
