# AI Prompt: Build Complete Wallet & Payment Backend

## Instruction to AI Agent

You are building the complete wallet and payment backend for a ride-hailing platform called "Vida". The backend is built on **NestJS** (TypeScript) with **PostgreSQL** database. Build all APIs required to run the wallet system end-to-end.

### Tech Stack
- **Framework**: NestJS (TypeScript)
- **Database**: PostgreSQL
- **ORM**: TypeORM or Prisma (choose what fits best)
- **Auth**: JWT (already exists — use Guards/middleware)
- **Payment Gateway**: Razorpay
- **All amounts in paisa** (₹1 = 100 paisa, stored as BIGINT)
- **Schema file**: `docs/wallet/wallet-schema-postgres.sql` (PostgreSQL version)
- **API Collection with sample payloads/responses**: `docs/rider-wallet-api-collection.md`
- **MySQL schema also available**: `docs/wallet/wallet-system-schema.sql` (for reference only)

### What to Build
Build a `wallet` module with these services:
1. **WalletService** — create wallet, get balance, credit, debit (with optimistic locking)
2. **TopUpService** — initiate top-up, confirm payment (Razorpay webhook verification)
3. **WithdrawalService** — rider withdrawal to bank/UPI with balance validation
4. **PaymentFlowService** — hold, capture, release for wallet payments during trips
5. **CashPaymentService** — record cash collection, trigger commission deduction
6. **CommissionEngine** — calculate and deduct platform commission
7. **BusinessRulesService** — configurable parameters from DB
8. **FraudDetectionService** — velocity checks, wallet freeze
9. **AuditService** — append-only audit log for all operations

### Key Rules
- Every mutation requires an `idempotency_key` — duplicate keys return original response
- Optimistic locking on wallet balance (`version` field)
- Rider wallets CAN go negative (for commission debt)
- Customer wallets CANNOT go negative
- Commission calculated on ORIGINAL fare, not discounted fare
- All balance updates are server-side: `balance = balance + delta` (never absolute values from client)
- Every operation must be within a DB transaction
- Wallet ownership verified on every request (user from JWT must match wallet owner)

---

## Complete Database Schema

The full PostgreSQL schema is in `docs/wallet/wallet-schema-postgres.sql`. Create TypeORM entities / Prisma models matching those tables exactly.

**Tables (15 total):**
1. `wallets` — core wallet (balance, status, version for optimistic locking)
2. `wallet_transactions` — immutable ledger (credits/debits)
3. `payment_transactions` — gateway order tracking (Razorpay)
4. `transaction_links` — maps payment txn to wallet txn
5. `wallet_holds` — pre-authorization holds during trips
6. `topup_limits_tracker` — daily/monthly top-up enforcement
7. `wallet_audit_log` — immutable audit trail
8. `refund_requests` — refund-to-source tracking
9. `trip_payments` — trip fare, discount, commission, status
10. `commission_ledger` — commission deduction records
11. `business_rules` — admin-configurable rules (key-value with effective dates)
12. `fraud_flags` — fraud detection flags
13. `rider_withdrawals` — payout tracking to bank/UPI
14. `device_fingerprints` — duplicate account detection
15. `user_active_sessions` — single device enforcement

**Run the schema:**
```bash
psql -U postgres -d vida -f docs/wallet/wallet-schema-postgres.sql
```

---

## API Endpoints to Build

All routes under `/api/rider/wallet/` — require JWT auth.

| Method | Endpoint | Service | Description |
|--------|----------|---------|-------------|
| GET | `/api/rider/wallet/:riderId` | WalletService | Get balance, status, blocked state |
| POST | `/api/rider/wallet/:riderId/topup/initiate` | TopUpService | Create Razorpay order |
| POST | `/api/rider/wallet/:riderId/topup/confirm` | TopUpService | Verify signature, credit wallet |
| GET | `/api/rider/wallet/:riderId/withdraw/info` | WithdrawalService | Get available balance, limits |
| POST | `/api/rider/wallet/:riderId/withdraw` | WithdrawalService | Initiate payout |
| GET | `/api/rider/wallet/:riderId/withdraw/:withdrawalId` | WithdrawalService | Get withdrawal status |
| GET | `/api/rider/wallet/:riderId/transactions` | WalletService | Paginated transaction history |
| GET | `/api/rider/trips/:riderId/active-cash` | CashPaymentService | Get pending cash trip |
| POST | `/api/rider/trips/:riderId/:tripId/confirm-cash` | CashPaymentService | Confirm collection, deduct commission |
| GET | `/api/rider/eligibility/:riderId` | WalletService | Can rider accept rides? |
| POST | `/api/admin/wallet/freeze` | WalletService | Admin freeze wallet |
| POST | `/api/admin/wallet/unfreeze` | WalletService | Admin unfreeze wallet |
| POST | `/api/admin/wallet/adjust` | WalletService | Admin manual adjustment |
| GET | `/api/admin/business-rules` | BusinessRulesService | Get all rules |
| PUT | `/api/admin/business-rules/:key` | BusinessRulesService | Update a rule |

---

## Business Rules (Default Values to Seed)

```json
{
  "rider_negative_balance_threshold": -10000,
  "rider_hard_cap": -50000,
  "commission_type": "percentage",
  "commission_rate": 2000,
  "min_topup_amount": 100,
  "max_wallet_balance": 100000000,
  "min_withdrawal_amount": 1000,
  "max_daily_withdrawal": 5000000,
  "withdrawal_cooling_period_minutes": 30,
  "velocity_check_window_seconds": 60,
  "velocity_check_max_transactions": 5,
  "optimistic_lock_max_retries": 3,
  "cash_confirm_timeout_minutes": 15,
  "hold_expiry_minutes": 30
}
```

---

## Critical Implementation Rules

1. **Idempotency**: Every POST endpoint accepts `idempotency_key`. Check DB first — if key exists, return cached response.
2. **Optimistic Locking**: All balance updates use `UPDATE wallets SET balance = balance + :delta WHERE wallet_id = :id AND version = :ver`. If rowCount=0, retry up to 3 times.
3. **Rider Negative Balance**: Remove `CHECK (cached_balance >= 0)` constraint for rider wallets. Handle at application layer — customers get rejected, riders are allowed negative.
4. **Commission on Original Fare**: `commission = original_fare * rate / 10000` (rate in basis points). Never use discounted_fare.
5. **Withdrawal Validation**: `amount > 0 AND amount <= cached_balance AND cached_balance > 0`. Reject otherwise.
6. **Wallet Ownership**: On every request, verify `JWT.sub === wallet.user_id`. Return 403 if mismatch.
7. **Frozen Wallet**: If `wallet.status === 'frozen'`, reject ALL mutations with `WALLET_FROZEN` error.
8. **Audit Everything**: Every balance change creates an audit_log entry with before/after state.
9. **Transactions**: ALL balance operations wrapped in a DB transaction. No partial commits.
10. **No Client-Controlled Balance**: Balance is NEVER set from a client value. Always computed server-side as delta.
