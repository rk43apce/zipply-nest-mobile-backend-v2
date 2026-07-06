-- ============================================================
-- WALLET & PAYMENT SYSTEM — COMPLETE SCHEMA (PostgreSQL)
-- All amounts in paisa (BIGINT). ₹1 = 100 paisa.
-- ============================================================

-- 1. WALLETS
CREATE TABLE IF NOT EXISTS wallets (
    wallet_id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'INR',
    cached_balance BIGINT NOT NULL DEFAULT 0,
    available_balance BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
    daily_topup_limit BIGINT NOT NULL DEFAULT 1000000,
    monthly_topup_limit BIGINT NOT NULL DEFAULT 10000000,
    kyc_level VARCHAR(10) NOT NULL DEFAULT 'basic' CHECK (kyc_level IN ('basic', 'full')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ NULL,
    version INT NOT NULL DEFAULT 1,
    UNIQUE (user_id, currency_code)
);
CREATE INDEX idx_wallets_status ON wallets(status);

-- 2. WALLET TRANSACTIONS (immutable ledger)
CREATE TABLE IF NOT EXISTS wallet_transactions (
    txn_id BIGSERIAL PRIMARY KEY,
    wallet_id BIGINT NOT NULL REFERENCES wallets(wallet_id),
    idempotency_key VARCHAR(64) NOT NULL UNIQUE,
    txn_type VARCHAR(10) NOT NULL CHECK (txn_type IN ('credit', 'debit')),
    txn_category VARCHAR(20) NOT NULL CHECK (txn_category IN ('topup', 'purchase', 'refund', 'reversal', 'hold_capture', 'hold_release', 'bonus', 'expiry')),
    amount BIGINT NOT NULL CHECK (amount > 0),
    running_balance BIGINT NOT NULL,
    reference_type VARCHAR(50) NULL,
    reference_id VARCHAR(64) NULL,
    description VARCHAR(255) NULL,
    status VARCHAR(15) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
    metadata JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ NULL
);
CREATE INDEX idx_wt_wallet_created ON wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX idx_wt_wallet_status ON wallet_transactions(wallet_id, status);
CREATE INDEX idx_wt_reference ON wallet_transactions(reference_type, reference_id);

-- 3. PAYMENT TRANSACTIONS (gateway tracking)
CREATE TABLE IF NOT EXISTS payment_transactions (
    payment_txn_id BIGSERIAL PRIMARY KEY,
    wallet_id BIGINT NOT NULL REFERENCES wallets(wallet_id),
    idempotency_key VARCHAR(64) NOT NULL UNIQUE,
    gateway_provider VARCHAR(20) NOT NULL CHECK (gateway_provider IN ('razorpay', 'stripe', 'paytm', 'phonepe', 'manual')),
    gateway_order_id VARCHAR(128) NULL,
    gateway_payment_id VARCHAR(128) NULL,
    gateway_signature VARCHAR(256) NULL,
    direction VARCHAR(10) NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
    amount BIGINT NOT NULL CHECK (amount > 0),
    currency_code CHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(15) NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'pending', 'authorized', 'captured', 'failed', 'refunded')),
    failure_reason VARCHAR(500) NULL,
    payment_method VARCHAR(50) NULL,
    gateway_response JSONB NULL,
    initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    authorized_at TIMESTAMPTZ NULL,
    captured_at TIMESTAMPTZ NULL,
    failed_at TIMESTAMPTZ NULL,
    expires_at TIMESTAMPTZ NULL
);
CREATE INDEX idx_pt_wallet_status ON payment_transactions(wallet_id, status);
CREATE INDEX idx_pt_gateway_order ON payment_transactions(gateway_provider, gateway_order_id);

-- 4. TRANSACTION LINKS
CREATE TABLE IF NOT EXISTS transaction_links (
    link_id BIGSERIAL PRIMARY KEY,
    payment_txn_id BIGINT NOT NULL REFERENCES payment_transactions(payment_txn_id),
    wallet_txn_id BIGINT NOT NULL REFERENCES wallet_transactions(txn_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (payment_txn_id, wallet_txn_id)
);

-- 5. WALLET HOLDS
CREATE TABLE IF NOT EXISTS wallet_holds (
    hold_id BIGSERIAL PRIMARY KEY,
    wallet_id BIGINT NOT NULL REFERENCES wallets(wallet_id),
    idempotency_key VARCHAR(64) NOT NULL UNIQUE,
    amount BIGINT NOT NULL CHECK (amount > 0),
    reason VARCHAR(255) NOT NULL,
    reference_type VARCHAR(50) NULL,
    reference_id VARCHAR(64) NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'captured', 'released', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    captured_at TIMESTAMPTZ NULL,
    released_at TIMESTAMPTZ NULL,
    capture_txn_id BIGINT NULL REFERENCES wallet_transactions(txn_id)
);
CREATE INDEX idx_wh_wallet_active ON wallet_holds(wallet_id, status);
CREATE INDEX idx_wh_expires ON wallet_holds(status, expires_at);

-- 6. TOPUP LIMITS TRACKER
CREATE TABLE IF NOT EXISTS topup_limits_tracker (
    tracker_id BIGSERIAL PRIMARY KEY,
    wallet_id BIGINT NOT NULL REFERENCES wallets(wallet_id),
    period_type VARCHAR(10) NOT NULL CHECK (period_type IN ('daily', 'monthly')),
    period_key VARCHAR(10) NOT NULL,
    total_amount BIGINT NOT NULL DEFAULT 0,
    txn_count INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (wallet_id, period_type, period_key)
);

-- 7. AUDIT LOG
CREATE TABLE IF NOT EXISTS wallet_audit_log (
    audit_id BIGSERIAL PRIMARY KEY,
    wallet_id BIGINT NOT NULL REFERENCES wallets(wallet_id),
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
);
CREATE INDEX idx_wal_wallet_time ON wallet_audit_log(wallet_id, created_at DESC);
CREATE INDEX idx_wal_action ON wallet_audit_log(action);
CREATE INDEX idx_wal_entity ON wallet_audit_log(entity_type, entity_id);

-- 8. REFUND REQUESTS
CREATE TABLE IF NOT EXISTS refund_requests (
    refund_id BIGSERIAL PRIMARY KEY,
    wallet_id BIGINT NOT NULL REFERENCES wallets(wallet_id),
    original_payment_txn_id BIGINT NOT NULL REFERENCES payment_transactions(payment_txn_id),
    wallet_txn_id BIGINT NULL REFERENCES wallet_transactions(txn_id),
    refund_amount BIGINT NOT NULL CHECK (refund_amount > 0),
    reason VARCHAR(500) NOT NULL,
    status VARCHAR(15) NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'processing', 'completed', 'failed')),
    gateway_refund_id VARCHAR(128) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ NULL
);

-- 9. TRIP PAYMENTS
CREATE TABLE IF NOT EXISTS trip_payments (
    trip_payment_id BIGSERIAL PRIMARY KEY,
    trip_id BIGINT NOT NULL UNIQUE,
    rider_id BIGINT NOT NULL,
    customer_id BIGINT NOT NULL,
    payment_method VARCHAR(10) NOT NULL CHECK (payment_method IN ('wallet', 'cash', 'mixed')),
    original_fare BIGINT NOT NULL,
    discounted_fare BIGINT NOT NULL,
    discount_amount BIGINT NOT NULL DEFAULT 0,
    commission_amount BIGINT NULL,
    commission_rate INT NULL,
    hold_id BIGINT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'hold_placed', 'cash_collected', 'completed', 'cancelled', 'refunded')),
    cash_collected_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    cancelled_at TIMESTAMPTZ NULL,
    cancellation_fee BIGINT NULL,
    idempotency_key VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tp_rider_status ON trip_payments(rider_id, status);
CREATE INDEX idx_tp_customer ON trip_payments(customer_id);

-- 10. COMMISSION LEDGER
CREATE TABLE IF NOT EXISTS commission_ledger (
    commission_id BIGSERIAL PRIMARY KEY,
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
);
CREATE INDEX idx_cl_rider ON commission_ledger(rider_id, status);

-- 11. BUSINESS RULES
CREATE TABLE IF NOT EXISTS business_rules (
    rule_id BIGSERIAL PRIMARY KEY,
    rule_key VARCHAR(100) NOT NULL,
    rule_value TEXT NOT NULL,
    value_type VARCHAR(10) NOT NULL DEFAULT 'string' CHECK (value_type IN ('int', 'string', 'json', 'boolean')),
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to TIMESTAMPTZ NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_br_key_active ON business_rules(rule_key, is_active, effective_from);

-- 12. FRAUD FLAGS
CREATE TABLE IF NOT EXISTS fraud_flags (
    flag_id BIGSERIAL PRIMARY KEY,
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
);
CREATE INDEX idx_ff_user ON fraud_flags(user_id, user_type);
CREATE INDEX idx_ff_status ON fraud_flags(status, severity);

-- 13. RIDER WITHDRAWALS
CREATE TABLE IF NOT EXISTS rider_withdrawals (
    withdrawal_id BIGSERIAL PRIMARY KEY,
    rider_id BIGINT NOT NULL,
    rider_wallet_id BIGINT NOT NULL,
    amount BIGINT NOT NULL CHECK (amount > 0),
    payout_method VARCHAR(20) NOT NULL CHECK (payout_method IN ('bank_transfer', 'upi')),
    payout_reference VARCHAR(128) NULL,
    wallet_txn_id BIGINT NULL,
    status VARCHAR(15) NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'processing', 'completed', 'failed', 'reversed')),
    failure_reason VARCHAR(255) NULL,
    idempotency_key VARCHAR(64) NOT NULL UNIQUE,
    initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ NULL,
    failed_at TIMESTAMPTZ NULL,
    reversed_at TIMESTAMPTZ NULL
);
CREATE INDEX idx_rw_rider_status ON rider_withdrawals(rider_id, status);

-- 14. DEVICE FINGERPRINTS
CREATE TABLE IF NOT EXISTS device_fingerprints (
    fingerprint_id BIGSERIAL PRIMARY KEY,
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
);
CREATE INDEX idx_df_device_hash ON device_fingerprints(device_hash);
CREATE INDEX idx_df_user ON device_fingerprints(user_id, user_type);

-- 15. USER ACTIVE SESSIONS (single device enforcement)
CREATE TABLE IF NOT EXISTS user_active_sessions (
    session_id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    user_type VARCHAR(10) NOT NULL CHECK (user_type IN ('customer', 'rider')),
    device_id VARCHAR(255) NOT NULL,
    device_hash VARCHAR(64) NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    device_name VARCHAR(255) NULL,
    ip_address VARCHAR(45) NULL,
    logged_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    invalidated_at TIMESTAMPTZ NULL,
    invalidated_reason VARCHAR(100) NULL,
    UNIQUE (user_id, user_type)
);
CREATE INDEX idx_uas_token ON user_active_sessions(token_hash);
CREATE INDEX idx_uas_device ON user_active_sessions(device_hash);
