
# AI Prompt — Build Vida Rider Backend (NestJS + PostgreSQL + Redis)

---

## PROMPT START

Build a complete NestJS backend that powers the Vida Rider delivery partner app. The rider app makes every API call listed below. You must implement ALL of them with exact request/response shapes shown.

## Tech Stack

- **NestJS** (TypeScript, latest)
- **PostgreSQL** (TypeORM, latest)
- **Redis** (ioredis — for GEO, locks, caching, rate limiting)
- **Socket.IO** (@nestjs/websockets — real-time offers & tracking)
- **BullMQ** (background workers — timeouts, cleanup)
- **JWT** (passport-jwt — authentication)
- **S3** (@aws-sdk/client-s3 or local disk — document uploads)

## Create Project

```bash
nest new vida-rider-api
cd vida-rider-api
npm install @nestjs/typeorm typeorm pg @nestjs/jwt @nestjs/passport passport passport-jwt @nestjs/websockets @nestjs/platform-socket.io socket.io @nestjs/bull bullmq ioredis @nestjs/config class-validator class-transformer bcrypt multer @aws-sdk/client-s3 @nestjs/throttler uuid
npm install -D @types/passport-jwt @types/bcrypt @types/multer
```

---

## PostgreSQL Schema

Create TypeORM entities AND a migration for all tables below.

```sql
-- 1. Riders (main profile)
CREATE TABLE riders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mobile VARCHAR(15) NOT NULL UNIQUE,
    name VARCHAR(100),
    date_of_birth DATE,
    gender VARCHAR(10) CHECK (gender IN ('male', 'female', 'other')),
    city VARCHAR(50),
    vehicle_type VARCHAR(20) DEFAULT 'bike' CHECK (vehicle_type IN ('bike', 'scooter', 'cargo_bike')),
    max_parcel_weight_kg DECIMAL(5,2) DEFAULT 10.0,
    onboarding_status VARCHAR(50) NOT NULL DEFAULT 'registered',
    rating DECIMAL(3,2) DEFAULT 0.00,
    total_deliveries INT DEFAULT 0,
    total_ratings INT DEFAULT 0,
    acceptance_rate DECIMAL(5,2) DEFAULT 100.00,
    cancellation_score INT DEFAULT 0,
    activated_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
-- Valid onboarding_status: registered, documents_submitted, documents_verified, background_check_in_progress, background_check_cleared, training_in_progress, training_completed, bank_verified, activated, rejected, expired

-- 2. OTP
CREATE TABLE otp_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mobile VARCHAR(15) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL,
    attempts INT DEFAULT 0,
    is_verified BOOLEAN DEFAULT FALSE,
    locked_until TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3. Documents
CREATE TABLE rider_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES riders(id) ON DELETE CASCADE,
    document_type VARCHAR(30) NOT NULL CHECK (document_type IN ('driving_license', 'vehicle_rc', 'aadhaar', 'pan')),
    file_url VARCHAR(500) NOT NULL,
    file_name VARCHAR(255),
    file_size_bytes INT,
    mime_type VARCHAR(50),
    upload_status VARCHAR(20) DEFAULT 'accepted',
    verification_status VARCHAR(20) DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'failed')),
    failure_reason VARCHAR(255),
    verified_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(rider_id, document_type)
);

-- 4. Background checks
CREATE TABLE background_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES riders(id),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'cleared', 'flagged', 'inconclusive')),
    provider_reference VARCHAR(100),
    result_details JSONB,
    initiated_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- 5. Training
CREATE TABLE training_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES riders(id),
    module_id VARCHAR(50) NOT NULL CHECK (module_id IN ('app_navigation', 'order_acceptance', 'pickup_delivery', 'customer_interaction', 'traffic_safety', 'platform_policies')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
    completed_at TIMESTAMP,
    UNIQUE(rider_id, module_id)
);

-- 6. Quiz
CREATE TABLE quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES riders(id),
    answers JSONB NOT NULL,
    score INT NOT NULL,
    total_questions INT DEFAULT 10,
    passed BOOLEAN NOT NULL,
    attempted_at TIMESTAMP DEFAULT NOW()
);

-- 7. Quiz questions (seeded)
CREATE TABLE quiz_questions (
    id SERIAL PRIMARY KEY,
    question TEXT NOT NULL,
    options JSONB NOT NULL,
    correct_option INT NOT NULL,
    explanation TEXT,
    is_active BOOLEAN DEFAULT TRUE
);

-- 8. Bank accounts
CREATE TABLE bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES riders(id),
    account_holder_name VARCHAR(100) NOT NULL,
    account_number_encrypted VARCHAR(500) NOT NULL,
    account_number_masked VARCHAR(20) NOT NULL,
    ifsc_code VARCHAR(11) NOT NULL,
    upi_id VARCHAR(100),
    verification_status VARCHAR(20) DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'failed')),
    verified_at TIMESTAMP,
    is_primary BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 9. Order dispatches
CREATE TABLE order_dispatches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id VARCHAR(50) NOT NULL UNIQUE,
    status VARCHAR(30) NOT NULL DEFAULT 'searching',
    phase SMALLINT DEFAULT 1,
    city VARCHAR(50) NOT NULL,
    pickup_lat DECIMAL(10,7) NOT NULL,
    pickup_lng DECIMAL(10,7) NOT NULL,
    pickup_address VARCHAR(255),
    pickup_contact_name VARCHAR(100),
    pickup_contact_phone VARCHAR(15),
    dropoff_lat DECIMAL(10,7) NOT NULL,
    dropoff_lng DECIMAL(10,7) NOT NULL,
    dropoff_address VARCHAR(255),
    dropoff_contact_name VARCHAR(100),
    dropoff_contact_phone VARCHAR(15),
    customer_id VARCHAR(50),
    parcel_weight_kg DECIMAL(5,2) DEFAULT 2.0,
    requires_heavy_vehicle BOOLEAN DEFAULT FALSE,
    special_notes TEXT,
    assigned_rider_id UUID REFERENCES riders(id),
    redispatch_count SMALLINT DEFAULT 0,
    riders_offered_count INT DEFAULT 0,
    riders_rejected_count INT DEFAULT 0,
    distance_km DECIMAL(6,2),
    estimated_earnings INT,
    started_at TIMESTAMP DEFAULT NOW(),
    assigned_at TIMESTAMP,
    en_route_at TIMESTAMP,
    arrived_pickup_at TIMESTAMP,
    picked_up_at TIMESTAMP,
    in_transit_at TIMESTAMP,
    delivered_at TIMESTAMP,
    cancelled_at TIMESTAMP
);
-- Valid status: searching, offered, assigned, en_route_pickup, arrived_pickup, picked_up, in_transit, delivered, redispatching, no_rider, cancelled

-- 10. Dispatch offers
CREATE TABLE dispatch_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispatch_id UUID NOT NULL REFERENCES order_dispatches(id),
    order_id VARCHAR(50) NOT NULL,
    rider_id UUID NOT NULL REFERENCES riders(id),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'timeout', 'cancelled')),
    phase SMALLINT NOT NULL,
    distance_km DECIMAL(6,2),
    estimated_earnings INT,
    timeout_seconds INT DEFAULT 30,
    reason VARCHAR(50),
    offered_at TIMESTAMP DEFAULT NOW(),
    responded_at TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

-- 11. Dispatch events (audit trail)
CREATE TABLE dispatch_events (
    id BIGSERIAL PRIMARY KEY,
    dispatch_id UUID NOT NULL REFERENCES order_dispatches(id),
    order_id VARCHAR(50) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    rider_id UUID,
    phase SMALLINT,
    details JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 12. Rider earnings
CREATE TABLE rider_earnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES riders(id),
    order_id VARCHAR(50) NOT NULL,
    dispatch_id UUID REFERENCES order_dispatches(id),
    earning_type VARCHAR(20) DEFAULT 'delivery' CHECK (earning_type IN ('delivery', 'cancellation_compensation', 'bonus', 'tip')),
    base_fare INT NOT NULL DEFAULT 0,
    distance_bonus INT DEFAULT 0,
    surge_bonus INT DEFAULT 0,
    tip INT DEFAULT 0,
    total INT NOT NULL,
    distance_km DECIMAL(6,2),
    duration_minutes INT,
    earned_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 13. Rider location log (async, high volume)
CREATE TABLE rider_locations (
    id BIGSERIAL PRIMARY KEY,
    rider_id UUID NOT NULL,
    lat DECIMAL(10,7) NOT NULL,
    lng DECIMAL(10,7) NOT NULL,
    speed DECIMAL(5,1),
    bearing DECIMAL(5,1),
    recorded_at TIMESTAMP DEFAULT NOW()
);

-- 14. Onboarding audit log
CREATE TABLE onboarding_events (
    id BIGSERIAL PRIMARY KEY,
    rider_id UUID NOT NULL REFERENCES riders(id),
    event_type VARCHAR(50) NOT NULL,
    from_status VARCHAR(50),
    to_status VARCHAR(50),
    details JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Redis Keys

| Key Pattern | Type | Purpose | TTL |
|-------------|------|---------|-----|
| `riders:online:{city}` | GEO SET | Rider positions for geo search | None |
| `rider:status:{rider_id}` | HASH | { status, city, lat, lng, last_seen, current_order_id, vehicle_type } | None |
| `order_lock:{order_id}` | STRING | rider_id who won (SETNX atomic) | 300s |
| `offer:timer:{offer_id}` | STRING | rider_id | timeout_seconds |
| `rate:location:{rider_id}` | STRING | "1" | 3s |
| `rider:offered:{rider_id}` | STRING | offer_id currently pending | timeout_seconds |

---

## API Response Envelope (ALL endpoints)

Every endpoint returns:
```typescript
// Success
{ success: true, data: { ... } }

// Error
{ success: false, error: { code: string, message: string } }
```

Implement a global response interceptor for this.

---

## COMPLETE API — Every Endpoint the Rider App Calls

---

### AUTH MODULE

#### POST /api/auth/otp/send

**Request:**
```json
{ "mobile": "9876543210" }
```

**Validation:**
- `mobile`: exactly 10 digits, first digit 6-9
- Check if number is locked (locked_until > now)

**Logic:**
1. Validate mobile format
2. Check if locked → return OTP_LOCKED error
3. Generate random 4-digit OTP (1000-9999)
4. Hash with bcrypt
5. Insert into `otp_requests` (expires_at = now + 5 min)
6. In DEV mode: log OTP to console (don't send real SMS)
7. In PROD: send via SMS provider

**Response 200:**
```json
{
  "success": true,
  "data": {
    "message": "OTP sent successfully",
    "expires_in_seconds": 300,
    "dev_otp": "4827"  // ONLY in development mode
  }
}
```

**Errors:**
- `INVALID_MOBILE` (400): format wrong
- `OTP_LOCKED` (429): `{ "code": "OTP_LOCKED", "message": "Too many attempts. Try again in X minutes", "locked_until": "ISO timestamp" }`

---

#### POST /api/auth/otp/verify

**Request:**
```json
{ "mobile": "9876543210", "otp": "4827" }
```

**Logic:**
1. Find latest non-expired, non-verified OTP for this mobile
2. If none found → OTP_EXPIRED
3. Compare bcrypt hash
4. Wrong: increment attempts. If attempts >= 3 → set locked_until = now + 15 min
5. Correct: mark is_verified = true
6. Find rider by mobile OR create new rider (onboarding_status = 'registered')
7. Generate JWT access token (payload: { rider_id, mobile, onboarding_status })
8. Generate refresh token

**Response 200:**
```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "refresh_token": "eyJ...",
    "expires_in": 604800,
    "rider": {
      "rider_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "mobile": "9876543210",
      "name": null,
      "onboarding_status": "registered",
      "is_new": true
    }
  }
}
```

**Errors:**
- `OTP_EXPIRED` (422)
- `OTP_INVALID` (422): `{ "code": "OTP_INVALID", "message": "Incorrect OTP. X attempts remaining" }`
- `OTP_LOCKED` (429)

---

#### POST /api/auth/token/refresh

**Request:**
```json
{ "refresh_token": "eyJ..." }
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "access_token": "new-jwt...",
    "expires_in": 604800
  }
}
```

---

### RIDER MODULE (Onboarding)

All endpoints below require `Authorization: Bearer <jwt>` header.

---

#### GET /api/rider/profile/:riderId

Get full rider profile.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "rider_id": "uuid",
    "mobile": "9876543210",
    "name": "Rajesh Kumar",
    "date_of_birth": "1998-05-15",
    "gender": "male",
    "city": "Mumbai",
    "vehicle_type": "bike",
    "max_parcel_weight_kg": 10.0,
    "onboarding_status": "activated",
    "rating": 4.8,
    "total_deliveries": 342,
    "acceptance_rate": 94.0,
    "cancellation_score": 1,
    "activated_at": "2026-06-15T09:00:00Z",
    "created_at": "2026-06-10T08:00:00Z",
    "bank_account": {
      "account_masked": "••••••••8901",
      "ifsc_code": "SBIN0001234",
      "upi_id": "rajesh@upi",
      "verification_status": "verified"
    }
  }
}
```

---

#### PUT /api/rider/profile/:riderId

Update rider profile (used from Profile > Edit Profile).

**Request:**
```json
{
  "name": "Rajesh Kumar",
  "city": "Mumbai",
  "vehicle_type": "bike",
  "max_parcel_weight_kg": 15.0
}
```

**Response 200:**
```json
{ "success": true, "data": { "message": "Profile updated", "rider_id": "uuid" } }
```

---

#### POST /api/rider/profile/complete

Complete profile during onboarding (step 1).

**Request:**
```json
{
  "name": "Rajesh Kumar",
  "date_of_birth": "1998-05-15",
  "gender": "male",
  "city": "Mumbai",
  "vehicle_type": "bike"
}
```

**Validation:**
- name: non-empty, min 2 chars
- date_of_birth: rider must be ≥ 18 years old
- gender: male | female | other
- city: non-empty
- vehicle_type: bike | scooter | cargo_bike

**Response 200:**
```json
{
  "success": true,
  "data": {
    "rider_id": "uuid",
    "onboarding_status": "registered",
    "profile_completed": true,
    "next_step": "documents"
  }
}
```

**Errors:**
- `AGE_INELIGIBLE` (422): "Must be at least 18 years old"

---

#### POST /api/rider/documents/upload

Upload one document (multipart form data).

**Content-Type:** multipart/form-data  
**Fields:**
- `document_type`: string (driving_license | vehicle_rc | aadhaar | pan)
- `file`: binary (JPEG, PNG, PDF — max 5MB)

**Validation:**
- File must be jpeg/png/pdf
- File max 5MB
- document_type must be valid

**Logic:**
1. Validate file type and size
2. Store file (S3 in prod, local disk in dev)
3. Upsert `rider_documents` record
4. Return full checklist

**Response 200:**
```json
{
  "success": true,
  "data": {
    "document_type": "driving_license",
    "upload_status": "accepted",
    "verification_status": "pending",
    "file_url": "https://storage.vida.app/docs/rider-uuid/driving_license.jpg",
    "checklist": {
      "driving_license": { "status": "uploaded", "verification": "pending" },
      "vehicle_rc": { "status": "uploaded", "verification": "pending" },
      "aadhaar": { "status": "not_uploaded" },
      "pan": { "status": "not_uploaded" }
    },
    "all_uploaded": false,
    "uploaded_count": 2,
    "total_required": 4
  }
}
```

**Errors:**
- `DOCUMENT_INVALID` (422): "File too large" or "Invalid format"

---

#### POST /api/rider/documents/submit

Submit all documents for verification.

**Request:** (empty body, uses rider_id from JWT)

**Validation:** All 4 documents must have upload_status = 'accepted'

**Logic:**
1. Check all 4 docs uploaded
2. Update rider.onboarding_status → 'documents_submitted'
3. Log onboarding event
4. In DEV mode: auto-verify all after 5 seconds (BullMQ delayed job)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "onboarding_status": "documents_submitted",
    "message": "Documents submitted for verification",
    "estimated_verification_hours": 24
  }
}
```

---

#### GET /api/rider/documents/:riderId

Get all document statuses.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "documents": [
      { "document_type": "driving_license", "upload_status": "accepted", "verification_status": "verified", "file_url": "...", "uploaded_at": "..." },
      { "document_type": "vehicle_rc", "upload_status": "accepted", "verification_status": "verified", "file_url": "...", "uploaded_at": "..." },
      { "document_type": "aadhaar", "upload_status": "accepted", "verification_status": "verified", "file_url": "...", "uploaded_at": "..." },
      { "document_type": "pan", "upload_status": "accepted", "verification_status": "failed", "failure_reason": "Name mismatch", "uploaded_at": "..." }
    ],
    "all_verified": false,
    "verified_count": 3,
    "onboarding_status": "documents_submitted"
  }
}
```

---

#### POST /api/rider/background-check/initiate

**Request:** (empty body, uses rider_id from JWT)

**Validation:** onboarding_status must be 'documents_verified'

**Logic:**
1. Create background_checks record (status: pending)
2. Update onboarding_status → 'background_check_in_progress'
3. In DEV: auto-clear after 5 seconds

**Response 200:**
```json
{
  "success": true,
  "data": {
    "status": "pending",
    "onboarding_status": "background_check_in_progress",
    "estimated_hours": 48
  }
}
```

---

#### GET /api/rider/background-check/:riderId

**Response 200:**
```json
{
  "success": true,
  "data": {
    "status": "cleared",
    "onboarding_status": "background_check_cleared",
    "completed_at": "2026-06-12T14:00:00Z"
  }
}
```

---

#### GET /api/rider/training/:riderId

Get training progress + module list.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "modules": [
      { "module_id": "app_navigation", "title": "How to Use Rider App", "duration_minutes": 5, "status": "completed", "completed_at": "..." },
      { "module_id": "order_acceptance", "title": "Accepting Orders", "duration_minutes": 4, "status": "completed", "completed_at": "..." },
      { "module_id": "pickup_delivery", "title": "Pickup & Delivery", "duration_minutes": 6, "status": "completed", "completed_at": "..." },
      { "module_id": "customer_interaction", "title": "Customer Communication", "duration_minutes": 4, "status": "pending" },
      { "module_id": "traffic_safety", "title": "Road Safety", "duration_minutes": 5, "status": "pending" },
      { "module_id": "platform_policies", "title": "Platform Rules & Earnings", "duration_minutes": 5, "status": "pending" }
    ],
    "completed_count": 3,
    "total_modules": 6,
    "quiz_unlocked": false,
    "quiz_passed": false
  }
}
```

---

#### POST /api/rider/training/module/update

**Request:**
```json
{ "module_id": "customer_interaction", "status": "completed" }
```

**Valid module_ids:** app_navigation, order_acceptance, pickup_delivery, customer_interaction, traffic_safety, platform_policies

**Logic:**
1. Upsert training_progress (rider_id, module_id)
2. If first module completed → rider.onboarding_status = 'training_in_progress'
3. Check if all 6 done → quiz_unlocked = true

**Response 200:**
```json
{
  "success": true,
  "data": {
    "module_id": "customer_interaction",
    "status": "completed",
    "completed_count": 4,
    "total_modules": 6,
    "quiz_unlocked": false
  }
}
```

---

#### GET /api/rider/training/quiz/questions

Get quiz questions (called when quiz screen loads).

**Response 200:**
```json
{
  "success": true,
  "data": {
    "questions": [
      { "index": 0, "question": "What should you do if the parcel is oversized for your vehicle?", "options": ["Deliver it anyway", "Cancel with reason 'oversized'", "Leave without informing", "Contact customer directly"] },
      { "index": 1, "question": "How often should you send GPS updates while online?", "options": ["Every 30 seconds", "Every 5 seconds", "Every minute", "Only when delivering"] },
      { "index": 2, "question": "What happens if you don't respond to an offer in 30 seconds?", "options": ["Nothing happens", "It's auto-rejected and goes to next rider", "Your account gets blocked", "You pay a penalty"] },
      { "index": 3, "question": "When can a customer cancel their order for free?", "options": ["Anytime", "Before rider is assigned", "After delivery", "Never"] },
      { "index": 4, "question": "What does a red dot on the map represent?", "options": ["Pickup location", "Dropoff location", "Your location", "Another rider"] },
      { "index": 5, "question": "If the store is closed when you arrive, what should you do?", "options": ["Wait 30 minutes", "Cancel with reason 'store_closed'", "Deliver from another store", "Call the admin"] },
      { "index": 6, "question": "What is the minimum rating to stay active on the platform?", "options": ["3.0", "3.5", "4.0", "4.5"] },
      { "index": 7, "question": "How long do you wait at pickup before you can cancel for 'long_wait'?", "options": ["5 minutes", "10 minutes", "15 minutes", "30 minutes"] },
      { "index": 8, "question": "What does 'SETNX' in the dispatch system prevent?", "options": ["Slow delivery", "Double assignment of same order", "GPS errors", "Payment fraud"] },
      { "index": 9, "question": "After marking delivered, your status becomes:", "options": ["offline", "on_trip", "available", "busy"] }
    ],
    "total_questions": 10,
    "pass_score": 8
  }
}
```

Note: Don't send correct answers to the client. Grade server-side only.

---

#### POST /api/rider/training/quiz/submit

**Request:**
```json
{ "answers": { "0": 1, "1": 1, "2": 1, "3": 1, "4": 1, "5": 1, "6": 2, "7": 1, "8": 1, "9": 2 } }
```

**Answer key (store server-side):** [1, 1, 1, 1, 1, 1, 2, 1, 1, 2]

**Logic:**
1. Verify all 6 modules completed first
2. Compare each answer to key
3. Calculate score
4. Pass = score >= 8
5. Insert quiz_attempts record
6. If passed → rider.onboarding_status = 'training_completed'

**Response 200 (passed):**
```json
{
  "success": true,
  "data": {
    "score": 9,
    "total_questions": 10,
    "passed": true,
    "pass_score": 8,
    "onboarding_status": "training_completed",
    "message": "Congratulations! You passed the quiz."
  }
}
```

**Response 200 (failed):**
```json
{
  "success": true,
  "data": {
    "score": 6,
    "total_questions": 10,
    "passed": false,
    "pass_score": 8,
    "message": "You scored 6/10. You need 8 to pass. Review the modules and try again.",
    "can_retry": true
  }
}
```

---

#### POST /api/rider/bank/submit

**Request:**
```json
{
  "account_holder_name": "Rajesh Kumar",
  "account_number": "912345678901",
  "ifsc_code": "SBIN0001234",
  "upi_id": "rajesh@upi"
}
```

**Validation:**
- account_number: 9-18 digits only
- ifsc_code: regex `^[A-Z]{4}0[A-Z0-9]{6}$` (11 chars)
- account_holder_name: must match rider.name (case-insensitive trim compare)
- upi_id: optional, if provided must contain '@'

**Logic:**
1. Validate all fields
2. Encrypt account_number (AES-256 or similar)
3. Create masked version: "••••••••" + last 4 digits
4. Insert bank_accounts record
5. In DEV: auto-verify immediately
6. Update rider.onboarding_status → 'bank_verified'

**Response 200:**
```json
{
  "success": true,
  "data": {
    "verification_status": "verified",
    "account_masked": "••••••••8901",
    "ifsc_code": "SBIN0001234",
    "upi_id": "rajesh@upi",
    "onboarding_status": "bank_verified",
    "message": "Bank account verified successfully"
  }
}
```

**Errors:**
- `IFSC_INVALID` (422)
- `ACCOUNT_NUMBER_INVALID` (422)
- `NAME_MISMATCH` (422): "Account holder name must match your profile name"

---

#### POST /api/rider/activate

Final activation.

**Logic:**
1. Check ALL: profile complete + docs verified + bg check cleared + quiz passed + bank verified
2. Set rider.onboarding_status → 'activated'
3. Set rider.activated_at = now
4. Log onboarding event
5. Return success

**Response 200:**
```json
{
  "success": true,
  "data": {
    "onboarding_status": "activated",
    "activated_at": "2026-07-01T09:00:00Z",
    "message": "Your account is activated! You can now go online and start earning."
  }
}
```

**Errors:**
- `ACTIVATION_INCOMPLETE` (422): `{ "missing_steps": ["training", "bank"] }`

---

#### GET /api/rider/onboarding/status/:riderId

Full onboarding progress (used by onboarding progress screen).

**Response 200:**
```json
{
  "success": true,
  "data": {
    "rider_id": "uuid",
    "onboarding_status": "training_in_progress",
    "steps": {
      "profile": { "completed": true },
      "documents": { "completed": true, "uploaded_count": 4, "verified_count": 4, "all_verified": true },
      "background_check": { "completed": true, "status": "cleared" },
      "training": { "completed": false, "modules_done": 4, "total_modules": 6, "quiz_unlocked": false, "quiz_passed": false },
      "bank": { "completed": false },
      "activation": { "completed": false }
    },
    "completed_steps": 3,
    "total_steps": 7,
    "current_step": "training",
    "next_action": "Complete remaining training modules"
  }
}
```

---

### DISPATCH MODULE

All endpoints require Bearer JWT.

---

#### POST /api/dispatch/online

**Request:**
```json
{
  "rider_id": "uuid",
  "city": "Mumbai",
  "lat": 19.0760,
  "lng": 72.8777,
  "vehicle_type": "bike",
  "max_parcel_weight_kg": 10
}
```

**Validation:**
- rider.onboarding_status must be 'activated'
- lat: 8.0 – 37.0 (India)
- lng: 68.0 – 97.0 (India)

**Logic:**
1. Validate rider is activated
2. Validate coordinates in India bounds
3. Redis: GEOADD `riders:online:{city}` {lng} {lat} {rider_id}
4. Redis: HSET `rider:status:{rider_id}` { status: 'available', city, lat, lng, last_seen: now, vehicle_type, max_parcel_weight_kg }
5. Return success

**Response 200:**
```json
{
  "success": true,
  "data": {
    "rider_id": "uuid",
    "status": "available",
    "city": "Mumbai",
    "online_since": "2026-07-01T09:00:00Z"
  }
}
```

**Errors:**
- `RIDER_NOT_ACTIVATED` (403)
- `INVALID_COORDINATES` (422)

---

#### POST /api/dispatch/offline

**Request:**
```json
{ "rider_id": "uuid" }
```

**Logic:**
1. Check if rider has pending offer → auto-reject it
2. Redis: ZREM `riders:online:{city}` {rider_id}
3. Redis: DEL `rider:status:{rider_id}`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "rider_id": "uuid",
    "status": "offline",
    "offline_at": "2026-07-01T17:00:00Z",
    "pending_offer_auto_rejected": false
  }
}
```

---

#### POST /api/dispatch/location

**Request:**
```json
{
  "rider_id": "uuid",
  "lat": 19.0785,
  "lng": 72.8756,
  "city": "Mumbai",
  "speed": 24.5,
  "bearing": 270
}
```

**Logic:**
1. Rate limit: check `rate:location:{rider_id}` exists → if yes, return 429
2. Set `rate:location:{rider_id}` with TTL 3s
3. Validate coordinates (India bounds)
4. Redis: GEOADD update position
5. Redis: HSET update last_seen in status hash
6. Queue: async write to rider_locations table (BullMQ job — don't block response)

**Response 200:**
```json
{ "success": true, "data": { "updated_at": "2026-07-01T09:05:00Z" } }
```

**Errors:**
- `RATE_LIMITED` (429): "Max 1 update per 3 seconds"
- `INVALID_COORDINATES` (422)

---

#### POST /api/dispatch/start

Called by Order Service (service-to-service auth), NOT by rider app directly.

**Request:**
```json
{
  "order_id": "ORD-20260701-9981",
  "pickup": {
    "lat": 19.0596,
    "lng": 72.8295,
    "address": "Cafe Coffee Day, Bandra West, Mumbai",
    "contact_name": "Store Manager",
    "contact_phone": "9876543210"
  },
  "dropoff": {
    "lat": 19.0728,
    "lng": 72.8826,
    "address": "14B, Juhu Scheme, Mumbai",
    "contact_name": "Priya Sharma",
    "contact_phone": "98712XXXXX"
  },
  "city": "Mumbai",
  "customer_id": "CUST-001",
  "order_meta": {
    "parcel_weight_kg": 2.5,
    "requires_heavy_vehicle": false,
    "special_notes": "Handle with care — fragile items"
  }
}
```

**Logic:**
1. Create order_dispatches record (status: 'searching', phase: 1)
2. Calculate distance_km between pickup and dropoff (Haversine)
3. Calculate estimated_earnings (base 4000 + distance * 1000 paisa)
4. Start dispatch algorithm: find nearby riders → send offer

**Dispatch Algorithm:**
```
Phase 1: GEOSEARCH radius 2km, pick nearest 1, timeout 30s
Phase 2: radius 3km, pick top 3, timeout 25s
Phase 3: radius 5km, pick top 5, timeout 20s
Phase 4: radius 8km, pick top 20, timeout 15s

For each phase:
  1. GEOSEARCH riders:online:{city} FROMLONLAT {pickup_lng} {pickup_lat} BYRADIUS {radius} km ASC
  2. Filter: status=available, last_seen < 60s, not in excluded list, weight capacity OK
  3. For each selected rider:
     - Create dispatch_offers record (status: pending, expires_at = now + timeout)
     - Set rider:status → 'busy'
     - SET rider:offered:{rider_id} = offer_id (TTL = timeout)
     - SET offer:timer:{offer_id} = rider_id (TTL = timeout)
     - Emit Socket.IO 'order_offer' to rider:{rider_id} room
  4. Wait for responses or timeouts

If all phases exhausted → status = 'no_rider', notify customer
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "dispatch_id": "uuid",
    "order_id": "ORD-20260701-9981",
    "status": "searching",
    "phase": 1,
    "search_radius_km": 2.0,
    "estimated_assignment_seconds": 90
  }
}
```

---

#### POST /api/dispatch/accept

**Request:**
```json
{ "offer_id": "uuid", "rider_id": "uuid" }
```

**CRITICAL — Atomic Lock:**
1. Validate offer exists, is 'pending', not expired
2. Validate rider_id matches the offer
3. Redis: `SET order_lock:{order_id} {rider_id} NX EX 300`
   - NX = only set if not exists (atomic)
4. **If SET returned OK (rider wins):**
   - dispatch_offers: this offer → 'accepted', responded_at = now
   - order_dispatches: status → 'assigned', assigned_rider_id, assigned_at = now
   - Cancel all OTHER pending offers for this order (status → 'cancelled')
   - Redis: rider status → 'on_trip', current_order_id = order_id
   - DEL `rider:offered:{rider_id}`
   - Release all other busy riders (set back to 'available')
   - Socket.IO: emit `offer_cancelled` to other offered riders
   - Socket.IO: emit `rider_assigned` to customer:{customer_id}
   - Log dispatch event
5. **If SET returned null (someone else won):**
   - This offer → 'cancelled', responded_at = now
   - Rider → 'available'
   - DEL `rider:offered:{rider_id}`

**Response 200 (WON):**
```json
{
  "success": true,
  "data": {
    "assigned": true,
    "order_id": "ORD-20260701-9981",
    "offer_id": "uuid",
    "dispatch_id": "uuid",
    "pickup": {
      "lat": 19.0596,
      "lng": 72.8295,
      "address": "Cafe Coffee Day, Bandra West, Mumbai",
      "contact_name": "Store Manager",
      "contact_phone": "9876543210"
    },
    "dropoff": {
      "lat": 19.0728,
      "lng": 72.8826,
      "address": "14B, Juhu Scheme, Mumbai",
      "contact_name": "Priya Sharma",
      "contact_phone_masked": "98712XXXXX"
    },
    "distance_km": 3.8,
    "estimated_earnings": 7800,
    "special_notes": "Handle with care — fragile items",
    "navigation_url": "https://maps.google.com/?q=19.0596,72.8295"
  }
}
```

**Response 200 (LOST):**
```json
{
  "success": true,
  "data": {
    "assigned": false,
    "offer_id": "uuid",
    "message": "Order was taken by another rider"
  }
}
```

**Errors:**
- `OFFER_NOT_FOUND` (404)
- `OFFER_EXPIRED` (422)
- `OFFER_ALREADY_RESPONDED` (409)

---

#### POST /api/dispatch/reject

**Request:**
```json
{ "offer_id": "uuid", "rider_id": "uuid", "reason": "too_far" }
```

**Valid reasons:** too_far, low_pay, busy, other

**Logic:**
1. Mark offer 'rejected', set reason, responded_at
2. Set rider back to 'available'
3. DEL `rider:offered:{rider_id}`
4. Increment order_dispatches.riders_rejected_count
5. Trigger: check if more riders in current phase to offer, else escalate

**Response 200:**
```json
{ "success": true, "data": { "offer_id": "uuid", "message": "Offer declined" } }
```

---

#### POST /api/dispatch/en-route-pickup

Rider starts heading to pickup (called after accept).

**Request:**
```json
{ "order_id": "ORD-20260701-9981", "rider_id": "uuid" }
```

**Validation:** status must be 'assigned'

**Logic:**
1. Update order_dispatches.status → 'en_route_pickup', en_route_at = now
2. Log dispatch event
3. Socket.IO: emit `dispatch_update` to customer

**Response 200:**
```json
{
  "success": true,
  "data": {
    "order_id": "ORD-20260701-9981",
    "status": "en_route_pickup",
    "message": "Rider is heading to pickup",
    "customer_message": "Your rider is heading to pick up your order!"
  }
}
```

---

#### POST /api/dispatch/arrived-pickup

**Request:**
```json
{ "order_id": "ORD-20260701-9981", "rider_id": "uuid" }
```

**Validation:** status must be 'assigned' or 'en_route_pickup'

**Logic:**
1. Update status → 'arrived_pickup', arrived_pickup_at = now
2. Log event
3. Socket.IO: emit `rider_at_pickup` to customer

**Response 200:**
```json
{
  "success": true,
  "data": {
    "order_id": "ORD-20260701-9981",
    "status": "arrived_pickup",
    "arrival_recorded_at": "2026-07-01T10:08:00Z",
    "customer_notified": true,
    "wait_timeout_minutes": 10,
    "message": "Waiting for parcel. Customer has been notified."
  }
}
```

---

#### POST /api/dispatch/picked-up

Rider collected the parcel.

**Request:**
```json
{ "order_id": "ORD-20260701-9981", "rider_id": "uuid" }
```

**Validation:** status must be 'arrived_pickup'

**Logic:**
1. Update status → 'picked_up', picked_up_at = now
2. Log event
3. Socket.IO: emit `order_picked_up` to customer

**Response 200:**
```json
{
  "success": true,
  "data": {
    "order_id": "ORD-20260701-9981",
    "status": "picked_up",
    "picked_up_at": "2026-07-01T10:12:00Z",
    "customer_message": "Your order has been picked up!"
  }
}
```

---

#### POST /api/dispatch/in-transit

Rider starts heading to customer.

**Request:**
```json
{ "order_id": "ORD-20260701-9981", "rider_id": "uuid" }
```

**Validation:** status must be 'picked_up'

**Logic:**
1. Update status → 'in_transit', in_transit_at = now
2. Log event
3. Socket.IO: emit `order_in_transit` to customer

**Response 200:**
```json
{
  "success": true,
  "data": {
    "order_id": "ORD-20260701-9981",
    "status": "in_transit",
    "customer_message": "Your order is on the way!"
  }
}
```

---

#### POST /api/dispatch/cancel-pickup

**Request:**
```json
{
  "order_id": "ORD-20260701-9981",
  "rider_id": "uuid",
  "reason_code": "oversized",
  "reason_text": "Parcel is larger than a standard box"
}
```

**Valid reason_codes:**
| Code | Re-dispatchable | Compensation |
|------|----------------|--------------|
| `oversized` | ✅ Yes (re-dispatch with heavy_vehicle) | ₹15 |
| `overweight` | ✅ Yes (weight filter) | ₹15 |
| `vehicle_breakdown` | ✅ Yes | ₹15 |
| `safety_concern` | ✅ Yes (flag for ops) | ₹15 |
| `long_wait` | ✅ Yes | ₹15 |
| `customer_unreachable` | ✅ Yes | ₹15 |
| `store_closed` | ❌ No (order cancelled, full refund) | ₹15 |
| `item_unavailable` | ❌ No (order cancelled, full refund) | ₹15 |
| `other` | Manual review | ₹0 |

**Validation:**
- Rider must be assigned to this order
- Status must be 'en_route_pickup', 'arrived_pickup', or 'picked_up' (not in_transit)
- redispatch_count < 3

**Logic:**
1. Release rider: status → 'available', DEL order_lock
2. If re-dispatchable:
   - status → 'redispatching', increment redispatch_count
   - Exclude this rider, re-run dispatch algorithm with updated context
   - Credit rider_earnings: cancellation_compensation = 1500 (₹15)
   - Socket.IO to customer: "Assigning a better-suited rider..."
3. If terminal (store_closed, item_unavailable):
   - status → 'cancelled', cancelled_at = now
   - Credit rider compensation
   - Socket.IO to customer: "Order cancelled. Full refund issued."
   - Trigger customer refund (emit event or call customer service)
4. Log dispatch event

**Response 200 (re-dispatch):**
```json
{
  "success": true,
  "data": {
    "cancelled": true,
    "redispatching": true,
    "redispatch_attempt": 2,
    "max_attempts": 3,
    "rider_compensation": 1500,
    "display_compensation": "₹15.00",
    "customer_message": "Assigning a better-suited rider..."
  }
}
```

**Response 200 (terminal):**
```json
{
  "success": true,
  "data": {
    "cancelled": true,
    "redispatching": false,
    "order_cancelled": true,
    "reason": "store_closed",
    "rider_compensation": 1500,
    "display_compensation": "₹15.00",
    "customer_message": "Order cancelled. Full refund issued."
  }
}
```

**Errors:**
- `INVALID_REASON_CODE` (422)
- `MAX_REDISPATCH_REACHED` (409)
- `INVALID_STATE` (409): "Cannot cancel in current delivery state"

---

#### POST /api/dispatch/delivered

**Request:**
```json
{
  "order_id": "ORD-20260701-9981",
  "rider_id": "uuid",
  "delivery_photo_url": "https://cdn.vida.app/proof/abc123.jpg",
  "recipient_name": "Priya"
}
```

**Validation:** status must be 'in_transit' (or 'picked_up' as fallback)

**Logic:**
1. Update order_dispatches: status → 'delivered', delivered_at = now
2. Calculate earnings:
   - base_fare = 4000 (₹40)
   - distance_bonus = distance_km * 1000 (₹10/km)
   - total = base_fare + distance_bonus
3. Insert rider_earnings record
4. Update rider: total_deliveries++
5. Redis: rider status → 'available', DEL current_order_id, DEL order_lock
6. Socket.IO: emit `order_delivered` to customer
7. Calculate trip duration: delivered_at - assigned_at
8. Calculate pickup wait: picked_up_at - arrived_pickup_at
9. Log dispatch event

**Response 200:**
```json
{
  "success": true,
  "data": {
    "order_id": "ORD-20260701-9981",
    "delivered_at": "2026-07-01T10:32:00Z",
    "earnings": {
      "base_fare": 4000,
      "distance_bonus": 3800,
      "surge_bonus": 0,
      "total": 7800,
      "display_total": "₹78.00"
    },
    "trip_summary": {
      "distance_km": 3.8,
      "duration_minutes": 24,
      "pickup_wait_minutes": 3
    },
    "rider_status_after": "available",
    "customer_notified": true
  }
}
```

---

#### GET /api/dispatch/status?rider_id=uuid

Get rider's current dispatch status (used by home screen to check if there's an active delivery).

**Response 200 (no active delivery):**
```json
{
  "success": true,
  "data": {
    "rider_id": "uuid",
    "status": "available",
    "city": "Mumbai",
    "lat": 19.0760,
    "lng": 72.8777,
    "last_seen": "2026-07-01T09:04:55Z",
    "current_order_id": null,
    "online_since": "2026-07-01T09:00:00Z"
  }
}
```

**Response 200 (active delivery):**
```json
{
  "success": true,
  "data": {
    "rider_id": "uuid",
    "status": "on_trip",
    "current_order_id": "ORD-20260701-9981",
    "active_delivery": {
      "order_id": "ORD-20260701-9981",
      "dispatch_id": "uuid",
      "delivery_status": "en_route_pickup",
      "pickup": { "lat": 19.0596, "lng": 72.8295, "address": "Cafe Coffee Day, Bandra West", "contact_name": "Store Manager", "contact_phone": "9876543210" },
      "dropoff": { "lat": 19.0728, "lng": 72.8826, "address": "14B, Juhu Scheme", "contact_name": "Priya Sharma", "contact_phone_masked": "98712XXXXX" },
      "distance_km": 3.8,
      "estimated_earnings": 7800,
      "special_notes": "Handle with care",
      "assigned_at": "2026-07-01T10:00:22Z"
    }
  }
}
```

---

### EARNINGS MODULE

---

#### GET /api/rider/earnings/summary?rider_id=uuid

Home screen earnings data (today + quick stats).

**Response 200:**
```json
{
  "success": true,
  "data": {
    "today": {
      "total": 78500,
      "display_total": "₹785.00",
      "deliveries": 7,
      "online_hours": 6.5
    },
    "week": {
      "total": 456000,
      "display_total": "₹4,560.00",
      "deliveries": 28
    },
    "stats": {
      "rating": 4.8,
      "acceptance_rate": 94.0,
      "total_deliveries": 342
    }
  }
}
```

---

#### GET /api/rider/earnings?rider_id=uuid&period=week

Full earnings screen data.

**Query params:** period = today | week | month

**Response 200:**
```json
{
  "success": true,
  "data": {
    "period": "week",
    "total_amount": 456000,
    "display_total": "₹4,560.00",
    "total_deliveries": 28,
    "avg_per_delivery": 16286,
    "daily": [
      { "day": "Mon", "date": "2026-06-30", "amount": 65000, "deliveries": 4 },
      { "day": "Tue", "date": "2026-07-01", "amount": 82000, "deliveries": 5 },
      { "day": "Wed", "date": "2026-07-02", "amount": 48000, "deliveries": 3 },
      { "day": "Thu", "date": "2026-07-03", "amount": 78500, "deliveries": 7 },
      { "day": "Fri", "date": "2026-07-04", "amount": 0, "deliveries": 0 },
      { "day": "Sat", "date": "2026-07-05", "amount": 0, "deliveries": 0 },
      { "day": "Sun", "date": "2026-07-06", "amount": 0, "deliveries": 0 }
    ],
    "breakdown": {
      "base_fares": 112000,
      "distance_bonuses": 288000,
      "surge_bonuses": 56000,
      "cancellation_compensation": 0,
      "total": 456000
    },
    "payout": {
      "next_payout_day": "Sunday",
      "estimated_amount": 456000,
      "bank_masked": "••••••••8901",
      "ifsc": "SBIN0001234",
      "upi_id": "rajesh@upi"
    }
  }
}
```

---

#### GET /api/rider/deliveries?rider_id=uuid&status=all&page=1&limit=20

Delivery history (paginated).

**Query params:**
- status: all | completed | cancelled
- page: int (default 1)
- limit: int (default 20)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "deliveries": [
      {
        "order_id": "ORD-20260701-9981",
        "from_address": "Bandra West",
        "to_address": "Juhu",
        "distance_km": 3.8,
        "duration_minutes": 24,
        "earnings": 7800,
        "display_earnings": "₹78.00",
        "status": "completed",
        "delivered_at": "2026-07-01T10:32:00Z"
      },
      {
        "order_id": "ORD-20260701-8823",
        "from_address": "Dadar",
        "to_address": "Lower Parel",
        "distance_km": 2.1,
        "duration_minutes": 15,
        "earnings": 6100,
        "display_earnings": "₹61.00",
        "status": "completed",
        "delivered_at": "2026-07-01T08:35:00Z"
      },
      {
        "order_id": "ORD-20260630-5541",
        "from_address": "Powai",
        "to_address": "Vikhroli",
        "distance_km": 5.1,
        "earnings": 0,
        "status": "cancelled",
        "cancel_reason": "store_closed",
        "cancelled_at": "2026-06-30T14:20:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 342,
      "total_pages": 18,
      "has_next": true
    }
  }
}
```

---

#### GET /api/rider/deliveries/recent?rider_id=uuid&limit=3

Recent deliveries for home screen.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "deliveries": [
      { "order_id": "ORD-20260701-9981", "from": "Bandra West", "to": "Juhu", "time": "Today, 9:45 AM", "distance_km": 3.8, "earnings": 7800, "display_earnings": "+₹78" },
      { "order_id": "ORD-20260701-8823", "from": "Dadar", "to": "Parel", "time": "Today, 8:20 AM", "distance_km": 2.1, "earnings": 6100, "display_earnings": "+₹61" },
      { "order_id": "ORD-20260701-7701", "from": "Andheri", "to": "Jogeshwari", "time": "Today, 7:10 AM", "distance_km": 4.2, "earnings": 8200, "display_earnings": "+₹82" }
    ]
  }
}
```

---

### SOCKET.IO GATEWAY

WebSocket gateway at path `/ws`.

**Connection:**
```
URL: wss://localhost:3000/ws
Auth handshake: { token: "Bearer <jwt>" }
```

On connect:
1. Extract JWT from handshake auth
2. Validate token
3. Join room: `rider:{rider_id}`
4. If rider has active delivery, also join: `delivery:{order_id}`

**Events Server → Rider:**

| Event | When | Payload |
|-------|------|---------|
| `order_offer` | Dispatch selects this rider | See below |
| `offer_cancelled` | Another rider won OR order cancelled | `{ offer_id, reason: "assigned_to_other" \| "order_cancelled" \| "timeout" }` |
| `order_assigned_confirmed` | This rider's accept won | Same as POST /accept success response |
| `dispatch_update` | Any delivery status change | `{ order_id, status, message }` |

**`order_offer` payload:**
```json
{
  "type": "order_offer",
  "offer_id": "uuid",
  "order_id": "ORD-20260701-9981",
  "pickup": {
    "lat": 19.0596,
    "lng": 72.8295,
    "address": "Cafe Coffee Day, Bandra West, Mumbai"
  },
  "dropoff": {
    "lat": 19.0728,
    "lng": 72.8826,
    "address": "14B, Juhu Scheme, Mumbai"
  },
  "distance_km": 3.8,
  "estimated_earnings": 7800,
  "display_earnings": "₹78.00",
  "timeout_seconds": 30,
  "expires_at": "2026-07-01T10:00:30Z",
  "special_notes": "Handle with care — fragile items",
  "parcel_weight_kg": 2.5
}
```

**Events Rider → Server:**

| Event | Frequency | Payload | Server Action |
|-------|-----------|---------|---------------|
| `location_update` | Every 5s | `{ lat, lng, speed?, bearing? }` | Update Redis GEO + last_seen |
| `ping` | Every 30s | `{}` | Update last_seen |

---

### BACKGROUND WORKERS (BullMQ)

#### 1. Offer Timeout Worker
- **Queue:** `dispatch-timeouts`
- **Runs:** Every 2 seconds (repeatable job)
- **Logic:**
  1. Query: `SELECT * FROM dispatch_offers WHERE status = 'pending' AND expires_at <= NOW()`
  2. For each expired offer:
     - Update status → 'timeout'
     - Set rider back to 'available' in Redis
     - DEL `rider:offered:{rider_id}`
     - Check: are there more riders to offer in current phase?
       - Yes → send offer to next rider
       - No → escalate to next phase
     - If phase 4 exhausted → set dispatch status → 'no_rider'

#### 2. Stale Rider Cleanup Worker
- **Queue:** `maintenance`
- **Runs:** Every 30 seconds (repeatable job)
- **Logic:**
  1. SCAN all `rider:status:*` keys in Redis
  2. For each: check `last_seen`
  3. If last_seen > 120 seconds ago:
     - ZREM from GEO set
     - If has pending offer → auto-reject
     - HSET status → 'offline'

#### 3. Location Logger Worker
- **Queue:** `telemetry`
- **Runs:** On each location event (triggered by POST /location and socket event)
- **Logic:** Batch insert into `rider_locations` table (don't block API response)

#### 4. Document Auto-Verifier (DEV ONLY)
- **Queue:** `onboarding`
- **Runs:** 5 seconds after document submit
- **Logic:** Set all documents to 'verified', update rider status

#### 5. Background Check Auto-Clearer (DEV ONLY)
- **Queue:** `onboarding`
- **Runs:** 5 seconds after initiation
- **Logic:** Set background_check to 'cleared', update rider status

---

## Business Rules (Must Implement)

| # | Rule | Implementation |
|---|------|---------------|
| 1 | All money in paisa | INT storage. ₹1 = 100 paisa. Display: amount/100 |
| 2 | Phone: 10 digits, starts 6-9 | Regex: `^[6-9]\d{9}$` |
| 3 | IFSC: 11 chars, specific format | Regex: `^[A-Z]{4}0[A-Z0-9]{6}$` |
| 4 | Account number: 9-18 digits | Regex: `^\d{9,18}$` |
| 5 | Age ≥ 18 | Calculate from DOB vs today |
| 6 | Coordinates: India bounds | lat: 8.0–37.0, lng: 68.0–97.0 |
| 7 | GPS rate limit: 1 per 3s | Redis key with 3s TTL |
| 8 | Rider stale: 120s no GPS | Worker removes from pool |
| 9 | Offer timeout: phase-dependent | Phase 1=30s, 2=25s, 3=20s, 4=15s |
| 10 | Atomic assignment: SETNX | Only 1 rider wins per order |
| 11 | Max 3 re-dispatches per order | Check redispatch_count before proceeding |
| 12 | OTP: 5 min expiry, 3 attempts lock | locked_until = now + 15min on 3rd fail |
| 13 | Only activated riders go online | Check onboarding_status in go_online |
| 14 | Earnings: ₹40 base + ₹10/km | base_fare=4000, distance_bonus=distance*1000 |
| 15 | Cancel compensation: ₹15 | 1500 paisa for legitimate cancels |
| 16 | Delivery step validation | Each step only from valid previous state |

---

## Delivery State Machine (Valid Transitions)

```
searching → offered → assigned → en_route_pickup → arrived_pickup → picked_up → in_transit → delivered
                                ↘ (cancel) → redispatching → (restart from searching)
                                ↘ (cancel terminal) → cancelled
searching → no_rider (if all phases fail)
```

**Only these transitions are valid:**
- assigned → en_route_pickup (POST /en-route-pickup)
- en_route_pickup → arrived_pickup (POST /arrived-pickup)
- arrived_pickup → picked_up (POST /picked-up)
- picked_up → in_transit (POST /in-transit)
- in_transit → delivered (POST /delivered)
- assigned|en_route_pickup|arrived_pickup → cancelled/redispatching (POST /cancel-pickup)

Reject any transition that doesn't match. Return `INVALID_STATE` error.

---

## Seed Data Script

Create a seed command (`npm run seed`) that:

1. Creates 15 test riders (all activated):
```
Rajesh Kumar, Amit Patel, Suresh Yadav, Vikram Singh, Deepak Sharma,
Rahul Verma, Manoj Tiwari, Karan Malhotra, Arun Nair, Pradeep Joshi,
Sachin More, Nitin Deshmukh, Ravi Gupta, Sanjay Mishra, Ajay Chauhan
```
All in Mumbai, various lat/lng around 19.05-19.08 lat, 72.81-72.88 lng.

2. Populates their Redis GEO positions (all available).

3. Seeds quiz_questions table with the 10 questions + correct answers.

4. Seeds training modules for a couple of riders (partially completed for testing).

---

## Environment Variables

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://vida:password@localhost:5432/vida_rider
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key-256-bit-minimum
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=your-refresh-secret
JWT_REFRESH_EXPIRES_IN=30d
UPLOAD_DIR=./uploads
# S3 (optional for prod)
S3_BUCKET=vida-documents
S3_REGION=ap-south-1
S3_ACCESS_KEY=
S3_SECRET_KEY=
```

---

## Docker Compose (for local dev)

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: vida_rider
      POSTGRES_USER: vida
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7
    ports:
      - "6379:6379"

volumes:
  pgdata:
```

---

## Quick Start

```bash
# Start databases
docker compose up -d

# Run migrations
npm run migration:run

# Seed data
npm run seed

# Start dev server
npm run start:dev
```

Server runs at: http://localhost:3000
Socket.IO at: ws://localhost:3000/ws

---

## CRITICAL REQUIREMENTS

1. Build EVERY endpoint listed — the rider app calls all of them
2. Use Redis SETNX for the dispatch/accept atomic lock — NOT a database lock
3. Socket.IO must emit `order_offer` to specific rider rooms
4. Offer timeout worker must auto-expire and trigger next offer/phase
5. All responses must use the `{ success, data/error }` envelope
6. Validate delivery state transitions strictly — reject invalid state changes
7. GPS location updates must be rate-limited (1 per 3s) via Redis
8. OTP must be hashed with bcrypt, never stored or returned in plain text (except dev mode)
9. Quiz answers must NEVER be sent to the client — grade server-side only
10. Encrypt bank account numbers before storing

## PROMPT END
