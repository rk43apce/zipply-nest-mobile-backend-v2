# Entity ↔ Schema Sync - Quick Reference Card

**TL;DR:** Always verify entity columns match database before coding.

---

## One-Minute Check

```bash
# 1. Get database columns
psql postgresql://vida:password@localhost:5433/vida_rider \
  -c "\d your_table_name"

# 2. Count them
SELECT COUNT(*) FROM information_schema.columns WHERE table_name='your_table_name';

# 3. Compare with @Column decorators in entity file
# → Must match exactly

# 4. If mismatch → Fix before committing ❌→✅

# 5. Run verification script
bash scripts/verify-entity-schema-sync.sh
```

---

## The 5-Step Workflow

```
1. Write Entity Class
   ↓
2. Run: psql ... -c "\d table_name"
   ↓
3. Compare columns → Check for mismatches
   ↓
4. Fix mismatches (entity or DB)
   ↓
5. Commit only when ✅ ALL MATCH
```

---

## Common Issues & Fixes

### ❌ "column X does not exist"
→ Your entity has @Column('X') but DB doesn't have it  
→ **Fix:** Remove @Column or create migration to add DB column

### ❌ "violates check constraint"  
→ You're inserting invalid default value  
→ **Fix:** Match constraint values (e.g., 'pending' not 'initiated')

### ❌ Column count mismatch
→ Entity has N columns, DB has M columns  
→ **Fix:** Add missing @Column decorators or remove extras

### ❌ Type mismatch
→ Entity says integer but DB is varchar  
→ **Fix:** Update @Column type to match DB

### ❌ Nullable mismatch
→ Entity has `@Column()` but DB is nullable  
→ **Fix:** Add `nullable: true` or make property optional with `?`

---

## Query Cheat Sheet

| Need | Command |
|------|---------|
| List columns | `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='X'` |
| Full table | `\d table_name` |
| CHECK constraints | `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname LIKE '%X%' AND contype='c'` |
| UNIQUE constraints | `SELECT indexname FROM pg_indexes WHERE tablename='X' AND indexdef LIKE '%UNIQUE%'` |
| FOREIGN keys | `\d+ table_name` (scroll to "Referenced by") |
| Column count | `SELECT COUNT(*) FROM information_schema.columns WHERE table_name='X'` |

---

## Entity Template

```typescript
/**
 * ====== ENTITY SCHEMA SYNC CHECK ======
 * Table: your_table_name (X columns)
 * Last Verified: YYYY-MM-DD
 * Status: ✅ SYNCED
 * ====================================
 */

import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('your_table_name')
export class YourEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  column1: string;

  @Column({ nullable: true })
  column2?: number;

  // ... add all DB columns ...
}
```

---

## Pre-Commit Checklist

```
Before hitting commit:

□ Ran psql \d table_name and saw all columns
□ Counted columns: DB has N, entity has N
□ Each @Column has matching DB column
□ No extra @Column decorators
□ Data types match
□ Nullable (?) matches is_nullable
□ Defaults match
□ Constraints verified
□ No ❌ red flags
□ Ran: bash scripts/verify-entity-schema-sync.sh
□ Got ✅ ALL SYNCED
□ Updated verification comment with date

✅ Ready to commit!
```

---

## Red Flags 🚩 (STOP & FIX)

```
❌ Column mismatch
❌ Unknown constraint
❌ Type mismatch
❌ Default value mismatch
❌ "column does not exist"
❌ "violates check constraint"

DO NOT COMMIT until ✅ all fixed
```

---

## Files to Know

| File | Purpose |
|------|---------|
| `.kiro/steering/ENTITY_SCHEMA_SYNC_RULE.md` | Full rule documentation |
| `ENTITY_VERIFICATION_TEMPLATE.md` | Template for verifying entities |
| `scripts/verify-entity-schema-sync.sh` | Auto-verification script |
| `.kiro/hooks/entity-sync-check.json` | Pre-commit hook |

---

## Running Verification

```bash
# Manual check
bash scripts/verify-entity-schema-sync.sh

# Output should show:
✅ payment_transactions (14 columns)
✅ wallets (14 columns)
✅ topup_limits_tracker (5 columns)
... etc

# If any ❌ → Fix before committing
```

---

## When Creating New Entity

```
1. Create @Entity class with @PrimaryGeneratedColumn
2. Run: psql -c "\d new_table_name"
3. Add @Column for EVERY column from step 2
4. Add verification comment at top
5. Run verification script
6. All ✅? → Commit ✓
```

---

## Real Example: Payment Transaction

**DB Schema (14 columns):**
```
id, wallet_id, amount, currency_code, status, 
gateway_provider, gateway_order_id, gateway_payment_id, 
payment_method, idempotency_key, metadata, 
initiated_at, captured_at, expires_at
```

**Entity:**
```typescript
@PrimaryGeneratedColumn('uuid') id: string; ✅
@Column('uuid') wallet_id: string; ✅
@Column('bigint') amount: number; ✅
@Column() currency_code?: string; ✅
@Column() status: string; ✅
@Column() gateway_provider?: string; ✅
@Column() gateway_order_id?: string; ✅
@Column() gateway_payment_id?: string; ✅
@Column() payment_method?: string; ✅
@Column({ unique: true }) idempotency_key: string; ✅
@Column({ type: 'jsonb' }) metadata?: Record<string, any>; ✅
@CreateDateColumn() initiated_at: Date; ✅
@Column({ nullable: true }) captured_at?: Date; ✅
@Column({ nullable: true }) expires_at?: Date; ✅
```

**All 14 columns mapped → ✅ SYNCED**

---

## Common Mistakes to Avoid

```typescript
// ❌ WRONG: Column doesn't exist in DB
@Column() gateway_signature: string;

// ✅ RIGHT: Store in metadata JSONB instead
@Column({ type: 'jsonb' }) metadata?: Record<string, any>;
// payment.metadata = { gateway_signature: sig };

// ❌ WRONG: Default not allowed by constraint
@Column({ default: 'initiated' }) status: string;
// DB CHECK allows only: pending, captured, failed, refunded

// ✅ RIGHT: Match constraint
@Column({ default: 'pending' }) status: string;

// ❌ WRONG: Forgot @CreateDateColumn but DB has it
export class Wallet {
  @Column() created_at: Date; // Won't auto-generate!
}

// ✅ RIGHT: Use TypeORM decorator
export class Wallet {
  @CreateDateColumn() created_at: Date; // Auto-generates
}
```

---

## Need Help?

```
Q: How do I know if columns match?
A: psql \d table_name → count columns → compare with @Column decorators

Q: What if I need a column not in DB?
A: Create migration or add to JSONB field

Q: When should I add @Column vs just a property?
A: @Column = stored in DB, plain property = in-memory only

Q: Can I use CreateDateColumn if it's not in DB?
A: NO - TypeORM will try to insert it → fails

Q: My entity broke at runtime but compiles fine?
A: Likely a column mismatch → run psql \d table_name
```

---

## TL;DR

**Before every entity commit:**
```
psql \d table_name  →  Count columns  →  Compare with entity  →  Fix mismatches  →  Commit ✅
```

That's it. This rule prevents 100% of "column does not exist" errors.

