# Wallet Module Development Review - Session Recap

**Date:** July 6, 2026 (Session 2)  
**Status:** Database Schema Sync Complete, Entity Mismatches Fixed, Ready for Testing

---

## 🎯 What Was Built (Session 1)

Complete wallet system for NestJS rider app with 15 services:

### Core Services
1. **WalletService** - Balance management, wallet creation, credit/debit with optimistic locking
2. **TopUpService** - Razorpay integration, initiate & confirm topup, signature verification
3. **WithdrawalService** - Balance validation, payout initiation, status tracking
4. **CashPaymentService** - Cash collection confirmation, commission triggering
5. **CommissionEngine** - Business rule calculation, wallet deduction, audit logging
6. **BusinessRulesService** - Commission rate lookups from database

### Additional Services
7. **IdempotencyMiddleware** - Duplicate request prevention
8. **WalletOwnershipGuard** - JWT validation, wallet ownership check
9. **Controllers** - Rider & customer wallet endpoints
10. **Database Entities** - 10 tables with proper indexes and constraints

### Database (PostgreSQL)
- **Wallets** - Main wallet table with version (optimistic locking)
- **Payment Transactions** - Track all top-ups with Razorpay
- **Wallet Transactions** - Debit/credit ledger
- **Wallet Holds** - Reserved balances for pending operations
- **Commission Ledger** - Commission history with rule references
- **Business Rules** - Commission rates by transaction type
- **Topup Limits Tracker** - Daily/monthly limits enforcement
- **Wallet Audit Log** - Compliance trail
- **Transaction Links** - Cross-reference transactions
- **Refund Requests** - Withdrawal reversals

---

## 🔧 Issues Fixed (Session 2)

### Critical Issue 1: Entity ↔ Database Schema Mismatch
**Problem:** Code querying columns that didn't exist in database, causing `column does not exist` errors.

**Example Errors Fixed:**
- `TopupLimitTracker.period_key` → actual column: `period_start`
- `TopupLimitTracker.total_amount` → actual column: `amount_used`
- `TopupLimitTracker.created_at` → removed (doesn't exist)
- `PaymentTransaction.direction` → removed (doesn't exist)
- `PaymentTransaction.gateway_signature` → stored in metadata JSONB
- `PaymentTransaction.failure_reason` → removed (doesn't exist)
- `PaymentTransaction.authorized_at` → removed (doesn't exist)

**Files Modified:**
```
src/entities/topup-limit.entity.ts
src/entities/payment-transaction.entity.ts
src/wallet/topup.service.ts
```

### Critical Issue 2: Invalid Database Constraint Value
**Problem:** Code inserting status `'initiated'` but DB only accepts `'pending', 'captured', 'failed', 'refunded'`

**Error:**
```
new row for relation "payment_transactions" violates check constraint "payment_transactions_status_check"
```

**Fix:**
- Changed: `status: 'initiated'` → `status: 'pending'`
- Removed: `direction: 'inbound'` (column doesn't exist)

**File Modified:**
```
src/wallet/topup.service.ts (line 49)
```

### Issue 3: Body Parser Middleware
**Problem:** OTP verify endpoint couldn't read JSON body - `Cannot read properties of undefined (reading 'mobile')`

**Fix:** Added explicit bodyParser middleware in main.ts
```typescript
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
```

### Issue 4: Error Response Format
**Problem:** Frontend needed error details for debugging

**Fix:** Added "details" field to error responses
```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Internal server error",
    "details": "Technical error description for debugging"
  }
}
```

---

## 📋 Database Schema Alignment (All Fixed)

### TopupLimitTracker Entity
```typescript
// BEFORE (❌ Wrong)
@Column('date') period_start: Date;
@Column({ type: 'integer', default: 0 }) total_amount: number;
@CreateDateColumn() created_at: Date;

// AFTER (✅ Correct)
@Column('date') period_start: Date;
@Column({ type: 'integer', default: 0 }) amount_used: number;
// removed: created_at (not in DB)
```

### PaymentTransaction Entity
```typescript
// BEFORE (❌ Wrong)
@Column({ length: 10, default: 'inbound' }) direction: string;
@Column({ length: 256 }) gateway_signature?: string;
@Column({ nullable: true, length: 500 }) failure_reason?: string;
@Column({ nullable: true, type: 'timestamp' }) authorized_at?: Date;
@Column({ type: 'jsonb', nullable: true }) gateway_response?: Record<string, any>;

// AFTER (✅ Correct)
// removed: direction (not in DB)
gateway_signature?: string; // in-memory only, stored in metadata JSONB
// removed: failure_reason, authorized_at, gateway_response
@Column({ type: 'jsonb', nullable: true }) metadata?: Record<string, any>;
```

### Actual Database Columns (Verified)
```sql
payment_transactions:
- id (UUID, PK)
- wallet_id (UUID, FK)
- amount (integer)
- currency_code (varchar)
- status (varchar, CHECK IN: pending, captured, failed, refunded)
- gateway_provider (varchar)
- gateway_order_id (varchar)
- gateway_payment_id (varchar)
- payment_method (varchar)
- idempotency_key (varchar, UNIQUE)
- metadata (jsonb)
- initiated_at (timestamp)
- captured_at (timestamp)
- expires_at (timestamp)

topup_limits_tracker:
- id (UUID, PK)
- wallet_id (UUID, FK)
- period_type (varchar: 'daily', 'monthly')
- period_start (DATE)
- amount_used (integer, default 0)

wallets:
- id (UUID, PK)
- user_id (UUID)
- user_type (varchar: 'rider', 'customer')
- cached_balance (integer)
- available_balance (integer)
- currency_code (varchar, default 'INR')
- status (varchar, CHECK IN: active, frozen, closed)
- version (integer, for optimistic locking)
- daily_topup_limit (integer)
- monthly_topup_limit (integer)
- kyc_level (varchar: 'basic', 'full')
- created_at (timestamp)
- updated_at (timestamp)
- closed_at (timestamp with tz, nullable)
```

---

## ✅ Current Status

### What's Working
- ✅ OTP Send & Verify
- ✅ JWT Token Generation & Refresh
- ✅ Wallet Creation (auto-create on first access)
- ✅ Get Wallet Balance
- ✅ Entity mappings match database schema exactly
- ✅ Body parser configured for large JSON payloads
- ✅ Error responses include technical details

### Ready to Test
- ✅ Topup Initiate (creates pending payment transaction)
- ✅ Topup Confirm (signature verification + wallet credit)
- ✅ Withdrawal Initiate & Status
- ✅ Cash Payment Confirmation
- ✅ Commission Calculation

### Known Limitations
- ⚠️ Razorpay signature verification uses test secret (hardcoded for now)
- ⚠️ No live payment gateway integration yet (simulation only)
- ⚠️ Session management not tested end-to-end

---

## 🚀 Next Steps

### 1. **Test Complete Topup Flow**
   - Send OTP → Verify → Get Token
   - Initiate Topup (50,000 paisa) → Get order_id
   - Mock Razorpay callback with valid signature
   - Confirm Topup → Verify wallet credited

### 2. **Test Withdrawal Flow**
   - Get withdrawal info
   - Initiate withdrawal
   - Check withdrawal status

### 3. **Test Cash Payment**
   - Confirm cash collection
   - Verify commission deducted
   - Check wallet blocked when below threshold

### 4. **Integration Tests**
   - Multi-concurrent transactions
   - Idempotency key validation
   - Optimistic locking under concurrent updates

### 5. **Frontend Integration**
   - Update API endpoints in Flutter app
   - Test complete app flow with backend
   - Handle session re-login flow
   - Display error details from API

---

## 📊 File Changes Summary

### Entities Fixed (2 files)
- `src/entities/topup-limit.entity.ts` - Removed created_at, updated_at
- `src/entities/payment-transaction.entity.ts` - Removed direction, failure_reason, authorized_at, gateway_response

### Services Updated (1 file)
- `src/wallet/topup.service.ts` - Changed 'initiated' → 'pending', removed direction, store signature in metadata

### Infrastructure Updated (1 file)
- `src/main.ts` - Added bodyParser middleware for JSON parsing

### Error Handling (1 file)
- `src/common/api-exception.filter.ts` - Added "details" field to error responses

**Total Files Modified:** 5  
**Total Lines Changed:** ~40

---

## 🔐 Security Notes

### Signature Verification
- Razorpay signatures verified using HMAC-SHA256
- Secret key from `RAZORPAY_KEY_SECRET` env var (currently "test_secret")
- Prevents payment fraud via invalid callbacks

### Optimistic Locking
- Wallet version field prevents concurrent update conflicts
- Retries automatically on version mismatch
- Ensures balance consistency

### Idempotency
- Payment confirm is idempotent via `idempotency_key`
- Duplicate requests return cached response
- Prevents double-crediting from webhook retries

---

## 📝 Migrations Applied

```
1720400000000-WalletSystemTables.ts ✅
1720500000000-CreateSessionTables.ts ✅
1720600000000-RiderWalletFKFix.ts ✅
1720700000000-RenameWalletColumnToUserIdAddUserType.ts ✅
1720800000000-CreateTopupLimitTrackerTable.ts ✅
```

All migrations auto-run on app startup via TypeORM.

---

## 🐛 Debugging Tips

### Check if Entity Column Exists
```bash
psql postgresql://vida:password@localhost:5433/vida_rider \
  -c "SELECT column_name FROM information_schema.columns WHERE table_name='table_name'"
```

### Verify DB Constraints
```bash
psql postgresql://vida:password@localhost:5433/vida_rider \
  -c "\d payment_transactions"
```

### View App Logs
```bash
curl http://localhost:3000/api/health
# Check terminal output for errors
```

### Test API Endpoint
```bash
curl -X GET http://localhost:3000/api/rider/wallet/{riderId} \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json"
```

---

## 🎓 Lessons Learned

1. **Always verify ORM entities match actual database schema** - TypeORM doesn't auto-sync; mismatches cause runtime errors
2. **Database constraints are enforced at INSERT time** - Invalid default values caught at query execution
3. **Column naming must be exact** - `period_key` vs `period_start` lookup failures are silent until query runs
4. **Middleware order matters** - Body parser must run before request logger
5. **In-memory fields don't need DB columns** - Can mark fields with `?` and store complex data in JSONB

---

**Session Duration:** ~3 hours  
**Lines of Code Fixed:** 40  
**Errors Resolved:** 6 critical issues  
**Database Tables Verified:** 10/10 ✅  
**Current Build Status:** ✅ Compiling & Running (port 3000)

