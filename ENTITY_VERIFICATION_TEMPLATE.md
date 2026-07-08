# Entity ↔ Database Schema Verification Template

Use this document to verify any entity before committing. Copy this section for each entity.

---

## Template (Copy and Fill)

```markdown
## Entity: [CLASS_NAME]
**Table Name:** [table_name]  
**Last Verified:** [DATE]  
**Verified By:** [NAME]  
**Status:** ✅ SYNCED / ❌ NEEDS_FIX

### Step 1: Get Database Schema
Run this command and paste output below:
```bash
psql postgresql://vida:password@localhost:5433/vida_rider \
  -c "SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name='[table_name]' 
      ORDER BY ordinal_position;"
```

**Database Schema Output:**
[paste output here]

### Step 2: List Entity Columns
List all @Column decorators from the entity file:
- [ ] column1 (type1) ✅
- [ ] column2 (type2) ✅
- [ ] column3 (type3) ❌ (issue)

### Step 3: Verify Constraints
Run:
```bash
\d [table_name]
```

**Constraints Found:**
[paste relevant constraints]

### Step 4: Check Mismatches

#### Extra Columns in Entity (remove these)
- [ ] None

#### Missing Columns in Entity (add these)
- [ ] None

#### Data Type Mismatches
- [ ] None

#### Nullable Mismatches
- [ ] None

#### Default Value Mismatches
- [ ] None

#### CHECK Constraint Violations
- [ ] None

### Sign-Off
- [ ] All columns mapped correctly
- [ ] No type mismatches
- [ ] Constraints verified
- [ ] Ready to commit ✅
```

---

## Real Examples (Reference)

### Example 1: PaymentTransaction ✅ VERIFIED

**Table Name:** payment_transactions  
**Last Verified:** 2024-07-07  
**Verified By:** Rajesh  
**Status:** ✅ SYNCED

### Database Schema:
```
 column_name     |          data_type          
-----------------+-----------------------------
 id              | uuid
 wallet_id       | uuid
 amount          | integer
 currency_code   | character varying
 status          | character varying
 gateway_provider| character varying
 gateway_order_id| character varying
 gateway_payment_id | character varying
 payment_method  | character varying
 idempotency_key | character varying
 metadata        | jsonb
 initiated_at    | timestamp without time zone
 captured_at     | timestamp without time zone
 expires_at      | timestamp without time zone
```

### Entity Columns:
```typescript
@PrimaryGeneratedColumn('uuid') id: string; ✅
@Column('uuid') wallet_id: string; ✅
@Column('bigint') amount: number; ✅
@Column({ nullable: true, length: 3, default: 'INR' }) currency_code?: string; ✅
@Column({ length: 15, default: 'pending' }) status: string; ✅
@Column({ nullable: true, length: 20 }) gateway_provider?: string; ✅
@Column({ nullable: true, length: 128 }) gateway_order_id?: string; ✅
@Column({ nullable: true, length: 128 }) gateway_payment_id?: string; ✅
@Column({ nullable: true, length: 50 }) payment_method?: string; ✅
@Column({ length: 64, unique: true }) idempotency_key: string; ✅
@Column({ type: 'jsonb', nullable: true }) metadata?: Record<string, any>; ✅
@CreateDateColumn({ type: 'timestamp' }) initiated_at: Date; ✅
@Column({ nullable: true, type: 'timestamp' }) captured_at?: Date; ✅
@Column({ nullable: true, type: 'timestamp' }) expires_at?: Date; ✅
```

### Mismatches Found:
**Removed:**
- ❌ direction (not in DB)
- ❌ gateway_signature (moved to metadata.gateway_signature)
- ❌ failure_reason (not in DB)
- ❌ authorized_at (not in DB)
- ❌ gateway_response (replaced with metadata)

**All Fixed:** ✅

---

### Example 2: TopupLimitTracker ✅ VERIFIED

**Table Name:** topup_limits_tracker  
**Last Verified:** 2024-07-07  
**Verified By:** Rajesh  
**Status:** ✅ SYNCED

### Database Schema:
```
 column_name  |     data_type     
--------------+-------------------
 id           | uuid
 wallet_id    | uuid
 period_type  | character varying
 period_start | date
 amount_used  | integer
```

### Entity Columns:
```typescript
@PrimaryGeneratedColumn('uuid') id: string; ✅
@Column('uuid') wallet_id: string; ✅
@Column({ length: 10 }) period_type: string; ✅
@Column('date') period_start: Date; ✅
@Column({ type: 'integer', default: 0 }) amount_used: number; ✅
```

### Mismatches Found:
**Removed:**
- ❌ period_key (was querying non-existent column)
- ❌ total_amount (was querying non-existent column)
- ❌ created_at (not in DB)
- ❌ updated_at (not in DB)

**All Fixed:** ✅

---

### Example 3: Wallet ✅ VERIFIED

**Table Name:** wallets  
**Last Verified:** 2024-07-07  
**Verified By:** Rajesh  
**Status:** ✅ SYNCED

### Database Schema:
```
       Column        |            Type             | Nullable | Default           
---------------------+-----------------------------+----------+-------------------
 id                  | uuid                        | not null | gen_random_uuid()
 user_id             | uuid                        | not null |
 currency_code       | character varying(3)        |          | 'INR'
 cached_balance      | integer                     | not null | 0
 available_balance   | integer                     | not null | 0
 status              | character varying(20)       |          | 'active'
 version             | integer                     | not null | 0
 daily_topup_limit   | integer                     |          | 1000000
 monthly_topup_limit | integer                     |          | 10000000
 created_at          | timestamp without time zone | not null | now()
 updated_at          | timestamp without time zone | not null | now()
 kyc_level           | character varying(10)       |          | 'basic'
 closed_at           | timestamp with time zone    |          |
 user_type           | character varying(10)       |          | 'rider'
```

### Entity Columns:
```typescript
@PrimaryGeneratedColumn('uuid') id: string; ✅
@Column('uuid') user_id: string; ✅
@Column({ length: 3, default: 'INR', nullable: true }) currency_code: string; ✅
@Column() cached_balance: number; ✅
@Column() available_balance: number; ✅
@Column({ length: 20, default: 'active', nullable: true }) status: string; ✅
@Column() version: number; ✅
@Column({ nullable: true }) daily_topup_limit: number; ✅
@Column({ nullable: true }) monthly_topup_limit: number; ✅
@CreateDateColumn() created_at: Date; ✅
@UpdateDateColumn() updated_at: Date; ✅
@Column({ length: 10, nullable: true, default: 'basic' }) kyc_level: string; ✅
@Column({ type: 'timestamp with time zone', nullable: true }) closed_at?: Date; ✅
@Column({ length: 10, nullable: true, default: 'rider' }) user_type: string; ✅
```

### Constraints Verified:
- ✅ CHECK (available_balance >= 0)
- ✅ CHECK (cached_balance >= 0)
- ✅ CHECK (kyc_level IN 'basic', 'full')
- ✅ CHECK (status IN 'active', 'frozen', 'closed')
- ✅ CHECK (user_type IN 'rider', 'customer')
- ✅ UNIQUE (user_id, user_type)

**All Constraints Matched:** ✅

---

## Quick Reference Queries

### Get Column Details
```bash
psql postgresql://vida:password@localhost:5433/vida_rider \
  -c "SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name='your_table';"
```

### Get Full Table Structure
```bash
psql postgresql://vida:password@localhost:5433/vida_rider
\d table_name
```

### Get CHECK Constraints
```bash
psql postgresql://vida:password@localhost:5433/vida_rider \
  -c "SELECT pg_get_constraintdef(oid) 
      FROM pg_constraint 
      WHERE conname LIKE '%table_name%' AND contype='c';"
```

### Get UNIQUE Constraints
```bash
psql postgresql://vida:password@localhost:5433/vida_rider \
  -c "SELECT indexname 
      FROM pg_indexes 
      WHERE tablename='table_name' AND indexdef LIKE '%UNIQUE%';"
```

### Get FOREIGN KEY Constraints
```bash
psql postgresql://vida:password@localhost:5433/vida_rider \
  -c "SELECT constraint_name, table_name, column_name 
      FROM information_schema.key_column_usage 
      WHERE table_name='table_name';"
```

---

## Checklist for Every Entity File

Before committing any entity file, verify:

- [ ] Database table exists
- [ ] Column count matches (@Column decorators)
- [ ] No extra @Column for non-existent DB columns
- [ ] No missing @Column for existing DB columns
- [ ] Data types match (TypeScript ↔ @Column type ↔ DB type)
- [ ] Nullable (?) matches is_nullable in DB
- [ ] DEFAULT values match between entity and DB
- [ ] Constraints (@Unique, @Index) exist in DB
- [ ] CHECK constraints match validation
- [ ] @CreateDateColumn/@UpdateDateColumn only used if in DB
- [ ] Foreign keys properly decorated
- [ ] Verification comment updated with date
- [ ] Ran: bash scripts/verify-entity-schema-sync.sh
- [ ] Output shows ✅ SYNCED
- [ ] Ready to commit ✅

**Never commit without ALL items checked.**

---

## When You Find a Mismatch

### Option 1: Fix the Entity (Usually Correct)
If DB schema is correct and entity is wrong:
```typescript
// Update entity decorators to match DB
```

### Option 2: Create Migration to Fix DB
If entity is correct and DB is outdated:
```typescript
// Create migration file in migrations/
// Run: npm run migration:run
```

### Option 3: Remove from Entity
If column isn't needed:
```typescript
// Store in JSONB or remove completely
```

---

## Sign-Off

When all verifications pass:

```
Entity: [ClassNam]
Table: [table_name]
Verified: ✅
Synced: ✅
Ready: ✅

Date: [ISO-DATE]
Verified By: [NAME]
```

Then commit!

