# Entity ↔ Database Schema Sync Rule

**Status:** MANDATORY - Apply to ALL database entities  
**Priority:** HIGH - Prevents runtime errors  
**Review Frequency:** Before every commit that touches entities or database

---

## 🔴 Problem This Solves

TypeORM entities can diverge from actual PostgreSQL schema, causing runtime failures:

```javascript
❌ RUNTIME ERRORS THAT COULD HAVE BEEN PREVENTED:
- column TopupLimitTracker.period_key does not exist
- column TopupLimitTracker.total_amount does not exist
- column TopupLimitTracker.created_at does not exist
- column PaymentTransaction.direction does not exist
- column PaymentTransaction.gateway_signature does not exist
- new row for relation "payment_transactions" violates check constraint

All detected ONLY at INSERT/SELECT time, not at compile time.
```

---

## ✅ The Rule: Always Verify Before Code Review

### Step 1: When Writing an Entity (TypeORM Decorator)

**For every @Entity class, IMMEDIATELY verify:**

```bash
# Connect to database and list actual columns
psql postgresql://vida:password@localhost:5433/vida_rider \
  -c "SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name='your_table_name' 
      ORDER BY ordinal_position;"
```

### Step 2: Create a Sync Checklist

For each entity file, add a comment block at the top:

```typescript
/**
 * ====== ENTITY ↔ DATABASE SCHEMA SYNC CHECK ======
 * Last Verified: 2024-07-07
 * Database Table: payment_transactions (14 columns)
 * 
 * COLUMNS MATCH ✅:
 * - id (uuid, PK) ✅
 * - wallet_id (uuid, FK) ✅
 * - amount (bigint) ✅
 * - currency_code (varchar) ✅
 * - status (varchar, CHECK: pending|captured|failed|refunded) ✅
 * - gateway_provider (varchar, nullable) ✅
 * - gateway_order_id (varchar, nullable) ✅
 * - gateway_payment_id (varchar, nullable) ✅
 * - payment_method (varchar, nullable) ✅
 * - idempotency_key (varchar, unique) ✅
 * - metadata (jsonb, nullable) ✅
 * - initiated_at (timestamp) ✅
 * - captured_at (timestamp, nullable) ✅
 * - expires_at (timestamp, nullable) ✅
 * 
 * EXTRA COLUMNS IN ENTITY (removed) ❌:
 * - direction (not in DB)
 * - gateway_signature (not in DB, stored in metadata instead)
 * - failure_reason (not in DB)
 * - authorized_at (not in DB)
 * - gateway_response (not in DB)
 * 
 * MISSING COLUMNS IN ENTITY (need to add) ⚠️:
 * (none - all DB columns mapped)
 * 
 * DB CONSTRAINTS TO VERIFY:
 * - payment_transactions.status CHECK: only pending|captured|failed|refunded
 * =====================================================
 */
```

### Step 3: Before Each Commit

Run this validation script:

```bash
#!/bin/bash
# scripts/verify-entity-schema-sync.sh

TABLES=(
  "payment_transactions:14"
  "topup_limits_tracker:5"
  "wallets:14"
  "wallet_transactions:8"
  "wallet_holds:6"
  "commission_ledger:7"
  "business_rules:5"
  "wallet_audit_log:8"
  "transaction_links:5"
  "refund_requests:8"
)

echo "🔍 Entity ↔ Schema Sync Check"
echo "=============================="

for table_spec in "${TABLES[@]}"; do
  table_name="${table_spec%:*}"
  expected_cols="${table_spec#*:}"
  
  actual_cols=$(psql postgresql://vida:password@localhost:5433/vida_rider \
    -t -c "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='$table_name';")
  
  if [ "$actual_cols" -eq "$expected_cols" ]; then
    echo "✅ $table_name ($actual_cols columns)"
  else
    echo "❌ $table_name (expected $expected_cols, found $actual_cols)"
    echo "   Action: Update entity decorator or database schema"
  fi
done

echo ""
echo "Run: psql ... -c \"SELECT column_name, data_type FROM information_schema.columns WHERE table_name='TABLE_NAME'\" to see details"
```

### Step 4: Manual Verification Checklist

```markdown
## Before PR Submission

- [ ] Each @Column decorator has matching DB column with same data_type
- [ ] No @Column used for columns that don't exist in DB
- [ ] All DB columns are mapped in entity (no unmapped columns)
- [ ] DEFAULT values in @Column match DB defaults
- [ ] Nullable properties (?) match DB is_nullable
- [ ] Length constraints match DB varchar length
- [ ] No stale @CreateDateColumn/@UpdateDateColumn if not in DB
- [ ] @Index names match DB index names (optional but good practice)
- [ ] CHECK constraints in @Column validators match DB CHECK constraints
- [ ] UNIQUE constraints in @Column match DB UNIQUE constraints
- [ ] Foreign keys (@Relation) match DB FOREIGN KEY constraints

If ANY of above fail → DO NOT COMMIT → Fix entity or database first
```

---

## 🛠️ How to Fix Mismatches

### Case 1: Column Exists in DB, Missing from Entity

**Fix:**
```typescript
// ❌ BEFORE: Entity missing column
export class PaymentTransaction {
  @Column() amount: number;
  @Column() status: string;
  // ❌ Missing: metadata column
}

// ✅ AFTER: Add the column
export class PaymentTransaction {
  @Column() amount: number;
  @Column() status: string;
  @Column({ type: 'jsonb', nullable: true }) metadata?: Record<string, any>;
}
```

### Case 2: Column Exists in Entity, Missing from DB

**Two options - choose based on use case:**

**Option A: Remove from entity (if not needed)**
```typescript
// ❌ BEFORE
@Column() gateway_signature: string;

// ✅ AFTER: Remove and store in metadata instead
@Column({ type: 'jsonb', nullable: true }) metadata?: Record<string, any>;
// In code: payment.metadata = { gateway_signature: sig };
```

**Option B: Create migration to add column to DB**
```typescript
// migration file: 1720900000000-AddGatewaySignatureToDB.ts
export class AddGatewaySignatureToDB1720900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn('payment_transactions', new TableColumn({
      name: 'gateway_signature',
      type: 'varchar',
      length: '256',
      isNullable: true
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('payment_transactions', 'gateway_signature');
  }
}

// Then run: npm run migration:run
```

### Case 3: Data Type Mismatch

**Example:**
```typescript
// ❌ WRONG: DB has integer, entity has string
@Column() amount: string;

// ✅ CORRECT: Match DB type
@Column('bigint') amount: number;

// Or create migration to fix DB:
await queryRunner.changeColumn('payment_transactions', 
  new TableColumn({ name: 'amount', type: 'varchar' }),
  new TableColumn({ name: 'amount', type: 'bigint' })
);
```

### Case 4: Constraint Mismatch

**Example:**
```typescript
// ❌ WRONG: Entity uses 'initiated' but DB CHECK allows only pending|captured|failed|refunded
@Column() status: string; // default: 'initiated'

// ✅ CORRECT: Use allowed values only
@Column({ length: 15, default: 'pending' }) status: string;

// In code, only use: 'pending', 'captured', 'failed', 'refunded'
```

---

## 📋 Entity Verification Template

Copy this template for every new entity:

```typescript
/**
 * ====== ENTITY SCHEMA SYNC VERIFICATION ======
 * Table: [TABLE_NAME]
 * Last Verified: [DATE]
 * Verified By: [YOUR_NAME]
 * Status: [✅ SYNCED / ❌ NEEDS_FIX]
 * 
 * DATABASE SCHEMA (psql output):
 * [Paste output of: SELECT column_name, data_type, is_nullable, column_default...]
 * 
 * ENTITY MAPPING:
 * [List each @Column and how it maps to DB column]
 * 
 * MISMATCHES FOUND:
 * [If any, list here with fix status]
 * 
 * SIGN-OFF:
 * DB matches entity: [yes/no]
 * Ready to merge: [yes/no]
 * ============================================
 */

@Entity('table_name')
export class YourEntity {
  // ... columns ...
}
```

---

## 🚀 Automation: Pre-Commit Hook

Create `.kiro/hooks/entity-sync-check.json`:

```json
{
  "version": "v1",
  "hooks": [{
    "name": "Entity Schema Sync Check",
    "trigger": "UserPromptSubmit",
    "action": {
      "type": "command",
      "command": "bash scripts/verify-entity-schema-sync.sh"
    }
  }]
}
```

This runs the verification script before every AI commit!

---

## ⚠️ Red Flags (STOP and Fix Before Commit)

Never commit if you see:

```bash
❌ Column mismatch found
❌ Column count mismatch
❌ Unknown constraint violation at runtime
❌ "column X does not exist"
❌ Check constraint violation
❌ DEFAULT value mismatch
❌ Type mismatch (varchar vs bigint, etc)
```

---

## 📚 Reference: How to Query Schema

### List all columns in a table
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name='payment_transactions'
ORDER BY ordinal_position;
```

### Check CHECK constraints
```sql
SELECT constraint_name, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname LIKE '%payment_transactions%' AND contype='c';
```

### Check UNIQUE constraints
```sql
SELECT indexname
FROM pg_indexes
WHERE tablename='payment_transactions' AND indexdef LIKE '%UNIQUE%';
```

### Check FOREIGN keys
```sql
SELECT constraint_name, table_name, column_name
FROM information_schema.key_column_usage
WHERE table_name='payment_transactions' AND constraint_type='FOREIGN KEY';
```

### Full table schema
```bash
\d payment_transactions  # PostgreSQL meta-command (best)
```

---

## 🎯 Checklist Before Every Commit

```markdown
## Entity & Schema Sync Pre-Commit Checklist

- [ ] Ran: SELECT column_name FROM information_schema.columns WHERE table_name='X'
- [ ] Column count matches (@Column decorators match DB columns)
- [ ] No extra @Column decorators for non-existent DB columns
- [ ] No missing @Column decorators for DB columns that should be mapped
- [ ] Data types match (TypeScript type ↔ @Column type ↔ DB type)
- [ ] Nullable properties (?) match DB is_nullable
- [ ] DEFAULT values match
- [ ] CHECK constraints validated (enum values, ranges, etc)
- [ ] Updated entity sync verification comment at top of file with date
- [ ] Ran verification script: bash scripts/verify-entity-schema-sync.sh
- [ ] All entities showing ✅ status
- [ ] Ready to commit ✅

If any check fails → Fix before committing
```

---

## Historical Examples (What We Fixed)

These mismatches were caught ONLY at runtime:

| Entity | Column | Problem | Fix |
|--------|--------|---------|-----|
| TopupLimitTracker | period_key | Didn't exist in DB | Changed to period_start |
| TopupLimitTracker | total_amount | Didn't exist in DB | Changed to amount_used |
| TopupLimitTracker | created_at | Not in DB, removed by sync | Removed @CreateDateColumn |
| PaymentTransaction | direction | Didn't exist in DB | Removed @Column |
| PaymentTransaction | gateway_signature | Not meant as DB column | Moved to metadata JSONB |
| PaymentTransaction | status | Default was 'initiated', DB only allows pending/captured/failed/refunded | Changed default to 'pending' |

**All of these would have been caught with this rule BEFORE coding.**

---

## Summary

**Rule: ALWAYS verify entities match database schema before writing code.**

```bash
# Your workflow:
1. Write entity
2. Run: SELECT columns FROM information_schema.columns WHERE table_name='X'
3. Compare with @Column decorators
4. Fix mismatches
5. Add verification comment with checksum
6. Commit only when ✅ synced
```

This prevents 100% of "column does not exist" runtime errors.

