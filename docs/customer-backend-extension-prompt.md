## PROMPT START

I have an existing NestJS backend running for the rider app. It already has:
- PostgreSQL + TypeORM setup
- Redis + ioredis
- Socket.IO gateway
- BullMQ workers
- JWT auth (passport-jwt)
- Dispatch module (dispatch engine, offers, delivery lifecycle)

Now I need to ADD customer-facing modules to the SAME project to support:
1. Customer onboarding (OTP login, profile)
2. Wallet (top-up, balance, transactions, holds)
3. Order management (estimate, create, track, cancel, rate)

**IMPORTANT NOTE:** This spec is a reference guide. The existing backend may have its own patterns, naming conventions, folder structure, and coding style. Feel free to modify, adjust, rename, or restructure anything in this document to fit the running backend. Adapt entity names, service patterns, module organization, DTO styles, and folder layout to match what's already in place. The API endpoints, request/response shapes, and business logic are what matter — the implementation structure should follow YOUR existing codebase conventions. If the existing project uses a different ORM pattern, different file naming, different auth guard setup, or different response formatting — follow the existing patterns and adapt this spec accordingly.

## What to Add

Generate these new modules inside the existing project:

```bash
nest generate module modules/customer
nest generate module modules/wallet  
nest generate module modules/orders
```

## New File Structure (add to existing src/modules/)

```
src/modules/
├── customer/
│   ├── customer.module.ts
│   ├── customer.controller.ts
│   ├── customer.service.ts
│   ├── entities/
│   │   ├── customer.entity.ts
│   │   ├── customer-otp.entity.ts
│   │   └── saved-address.entity.ts
│   └── dto/
│       ├── send-otp.dto.ts
│       ├── verify-otp.dto.ts
│       └── update-profile.dto.ts
├── wallet/
│   ├── wallet.module.ts
│   ├── wallet.controller.ts
│   ├── wallet.service.ts
│   ├── entities/
│   │   ├── wallet.entity.ts
│   │   ├── wallet-transaction.entity.ts
│   │   ├── wallet-hold.entity.ts
│   │   ├── payment-transaction.entity.ts
│   │   └── topup-limit.entity.ts
│   └── dto/
│       ├── initiate-topup.dto.ts
│       └── place-hold.dto.ts
├── orders/
│   ├── orders.module.ts
│   ├── orders.controller.ts
│   ├── orders.service.ts
│   ├── entities/
│   │   ├── order.entity.ts
│   │   ├── order-event.entity.ts
│   │   └── order-rating.entity.ts
│   └── dto/
│       ├── estimate-order.dto.ts
│       ├── create-order.dto.ts
│       ├── cancel-order.dto.ts
│       └── rate-order.dto.ts
```

Register all new modules in `app.module.ts` imports.

---

## Migration — New PostgreSQL Tables

Create a new migration file that adds these tables alongside existing rider tables:

```sql
-- Customers
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mobile VARCHAR(15) NOT NULL UNIQUE,
    name VARCHAR(100),
    email VARCHAR(255),
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Customer OTP
CREATE TABLE customer_otp_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mobile VARCHAR(15) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL,
    attempts INT DEFAULT 0,
    is_verified BOOLEAN DEFAULT FALSE,
    locked_until TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Wallets
CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) UNIQUE,
    currency_code VARCHAR(3) DEFAULT 'INR',
    cached_balance INT NOT NULL DEFAULT 0 CHECK (cached_balance >= 0),
    available_balance INT NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
    version INT NOT NULL DEFAULT 0,
    daily_topup_limit INT DEFAULT 1000000,
    monthly_topup_limit INT DEFAULT 10000000,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Payment transactions (gateway top-ups)
CREATE TABLE payment_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id),
    amount INT NOT NULL,
    currency_code VARCHAR(3) DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'captured', 'failed', 'refunded')),
    gateway_provider VARCHAR(20) DEFAULT 'razorpay',
    gateway_order_id VARCHAR(100),
    gateway_payment_id VARCHAR(100),
    payment_method VARCHAR(30),
    idempotency_key VARCHAR(64) NOT NULL UNIQUE,
    metadata JSONB,
    initiated_at TIMESTAMP DEFAULT NOW(),
    captured_at TIMESTAMP,
    expires_at TIMESTAMP
);

-- Wallet transactions (ledger)
CREATE TABLE wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id),
    txn_type VARCHAR(10) NOT NULL CHECK (txn_type IN ('credit', 'debit')),
    txn_category VARCHAR(30) NOT NULL CHECK (txn_category IN ('topup', 'order_payment', 'hold_capture', 'refund', 'cancellation_fee', 'bonus')),
    amount INT NOT NULL,
    running_balance INT NOT NULL,
    description VARCHAR(255),
    status VARCHAR(20) DEFAULT 'completed',
    reference_type VARCHAR(30),
    reference_id VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Wallet holds
CREATE TABLE wallet_holds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id),
    amount INT NOT NULL,
    reason VARCHAR(255),
    reference_type VARCHAR(30),
    reference_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'captured', 'released', 'expired')),
    idempotency_key VARCHAR(64) NOT NULL UNIQUE,
    capture_txn_id UUID REFERENCES wallet_transactions(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    captured_at TIMESTAMP,
    released_at TIMESTAMP
);

-- Top-up limits tracker
CREATE TABLE topup_limits_tracker (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES wallets(id),
    period_type VARCHAR(10) NOT NULL CHECK (period_type IN ('daily', 'monthly')),
    period_start DATE NOT NULL,
    amount_used INT NOT NULL DEFAULT 0,
    UNIQUE(wallet_id, period_type, period_start)
);

-- Orders
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id VARCHAR(50) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'searching', 'assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'in_transit', 'delivered', 'cancelled')),
    pickup_lat DECIMAL(10,7) NOT NULL,
    pickup_lng DECIMAL(10,7) NOT NULL,
    pickup_address VARCHAR(255) NOT NULL,
    pickup_contact_name VARCHAR(100),
    pickup_contact_phone VARCHAR(15),
    dropoff_lat DECIMAL(10,7) NOT NULL,
    dropoff_lng DECIMAL(10,7) NOT NULL,
    dropoff_address VARCHAR(255) NOT NULL,
    dropoff_contact_name VARCHAR(100) NOT NULL,
    dropoff_contact_phone VARCHAR(15) NOT NULL,
    parcel_weight_kg DECIMAL(5,2) DEFAULT 1.0,
    special_notes TEXT,
    distance_km DECIMAL(6,2),
    base_fare INT NOT NULL,
    distance_fare INT NOT NULL,
    weight_surcharge INT DEFAULT 0,
    platform_fee INT DEFAULT 500,
    total_amount INT NOT NULL,
    payment_method VARCHAR(20) DEFAULT 'wallet' CHECK (payment_method IN ('wallet', 'cash', 'upi')),
    hold_id UUID REFERENCES wallet_holds(id),
    cancellation_fee INT DEFAULT 0,
    assigned_rider_id UUID,
    rider_name VARCHAR(100),
    rider_phone_masked VARCHAR(15),
    rider_vehicle_type VARCHAR(20),
    rider_rating DECIMAL(3,2),
    estimated_delivery_minutes INT,
    confirmed_at TIMESTAMP,
    assigned_at TIMESTAMP,
    picked_up_at TIMESTAMP,
    delivered_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    cancel_reason VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Order timeline events
CREATE TABLE order_events (
    id BIGSERIAL PRIMARY KEY,
    order_id VARCHAR(50) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    title VARCHAR(100) NOT NULL,
    description VARCHAR(255),
    details JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Order ratings
CREATE TABLE order_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id VARCHAR(50) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    rider_id UUID,
    delivery_rating INT NOT NULL CHECK (delivery_rating BETWEEN 1 AND 5),
    rider_rating INT NOT NULL CHECK (rider_rating BETWEEN 1 AND 5),
    comments TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Saved addresses
CREATE TABLE saved_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    label VARCHAR(50) NOT NULL,
    address VARCHAR(255) NOT NULL,
    lat DECIMAL(10,7) NOT NULL,
    lng DECIMAL(10,7) NOT NULL,
    contact_name VARCHAR(100),
    contact_phone VARCHAR(15),
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_customers_mobile ON customers(mobile);
CREATE INDEX idx_wallets_customer ON wallets(customer_id);
CREATE INDEX idx_payment_txn_wallet ON payment_transactions(wallet_id);
CREATE INDEX idx_wallet_txn_wallet ON wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX idx_holds_wallet ON wallet_holds(wallet_id, status);
CREATE INDEX idx_orders_customer ON orders(customer_id, created_at DESC);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_events ON order_events(order_id);
CREATE INDEX idx_saved_addr ON saved_addresses(customer_id);
```

---

## JWT Strategy Update

You already have a JWT strategy for riders. Add a SEPARATE guard or strategy for customers, OR use a shared strategy that identifies user type from the token payload:

```typescript
// Token payload structure
interface JwtPayload {
  sub: string;        // user ID (rider_id or customer_id)
  mobile: string;
  type: 'rider' | 'customer';  // ADD THIS to distinguish
  iat: number;
  exp: number;
}
```

Create a `CustomerAuthGuard` that validates `type === 'customer'` from the JWT.

---

## ALL API ENDPOINTS TO BUILD

Response envelope for ALL:
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": { "code": "...", "message": "..." } }
```

---

### CUSTOMER AUTH

#### POST /api/customer/otp/send

```json
// Request
{ "mobile": "9871234567" }

// Response 200
{ "success": true, "data": { "message": "OTP sent", "expires_in_seconds": 300, "dev_otp": "1234" } }
```
- Validate: 10 digits, starts with 6-9
- Check lock (3 wrong = 15 min lock)
- Generate 4-digit OTP, bcrypt hash, store with 5-min expiry
- DEV: log OTP, accept "1234" as universal

---

#### POST /api/customer/otp/verify

```json
// Request
{ "mobile": "9871234567", "otp": "1234" }

// Response 200
{
  "success": true,
  "data": {
    "access_token": "jwt...",
    "refresh_token": "jwt...",
    "expires_in": 604800,
    "customer": { "customer_id": "uuid", "mobile": "9871234567", "name": null, "is_new": true },
    "wallet": { "wallet_id": "uuid", "balance": 0, "available_balance": 0, "display_balance": "₹0.00" }
  }
}
```
- Verify OTP hash
- Find or create customer
- Auto-create wallet if new customer
- Issue JWT with `type: 'customer'`

---

#### POST /api/customer/token/refresh

```json
// Request
{ "refresh_token": "jwt..." }
// Response
{ "success": true, "data": { "access_token": "new-jwt", "expires_in": 604800 } }
```

---

#### GET /api/customer/profile

```json
// Response
{
  "success": true,
  "data": {
    "customer_id": "uuid", "mobile": "9871234567", "name": "Priya Sharma", "email": "priya@example.com",
    "wallet": { "wallet_id": "uuid", "balance": 50000, "available_balance": 42000, "display_balance": "₹500.00", "display_available": "₹420.00" },
    "created_at": "2026-06-01T10:00:00Z"
  }
}
```

---

#### PUT /api/customer/profile

```json
// Request
{ "name": "Priya Sharma", "email": "priya@example.com" }
// Response
{ "success": true, "data": { "customer_id": "uuid", "name": "Priya Sharma", "email": "priya@example.com", "message": "Profile updated" } }
```

---

### WALLET

#### GET /api/wallet/:walletId

```json
{
  "success": true,
  "data": {
    "wallet_id": "uuid", "customer_id": "uuid", "cached_balance": 50000, "available_balance": 42000,
    "display_balance": "₹500.00", "display_available": "₹420.00", "status": "active",
    "daily_topup_limit": 1000000, "monthly_topup_limit": 10000000
  }
}
```

---

#### GET /api/wallet/:walletId/limits

```json
{
  "success": true,
  "data": {
    "daily": { "limit": 1000000, "used": 50000, "remaining": 950000, "display_limit": "₹10,000", "display_used": "₹500", "display_remaining": "₹9,500" },
    "monthly": { "limit": 10000000, "used": 150000, "remaining": 9850000, "display_limit": "₹1,00,000", "display_used": "₹1,500", "display_remaining": "₹98,500" }
  }
}
```

---

#### POST /api/wallet/topup/initiate

```json
// Request
{ "wallet_id": "uuid", "amount": 50000, "idempotency_key": "topup_uuid_1720000001" }

// Response 201
{
  "success": true,
  "data": {
    "payment_txn_id": "uuid", "amount": 50000, "status": "pending",
    "gateway_order_id": "order_NxB8aA1KQdlP2s",
    "gateway_checkout_data": { "key": "rzp_test_xxxx", "order_id": "order_NxB8aA1KQdlP2s", "amount": 50000, "currency": "INR", "name": "Vida", "description": "Add ₹500.00 to wallet" },
    "expires_at": "2026-07-01T11:00:00Z"
  }
}
```
- Check daily/monthly limits
- Create payment_transactions record
- Create Razorpay order (mock for dev: just return fake order_id)
- For DEV mode: auto-capture immediately (skip webhook), credit wallet directly

**Errors:** DAILY_LIMIT_EXCEEDED, MONTHLY_LIMIT_EXCEEDED, WALLET_FROZEN, INVALID_AMOUNT

---

#### POST /api/wallet/topup/confirm (DEV shortcut)

For development without Razorpay webhook. Manually confirm a pending top-up.

```json
// Request
{ "payment_txn_id": "uuid" }

// Response 200
{
  "success": true,
  "data": {
    "payment_txn_id": "uuid", "status": "captured", "amount_credited": 50000,
    "new_balance": 50000, "display_new_balance": "₹500.00"
  }
}
```

Logic (same as webhook):
1. Find pending payment_transaction
2. BEGIN TRANSACTION:
   - payment_transaction.status → 'captured', captured_at = now
   - INSERT wallet_transaction (credit, topup, amount)
   - UPDATE wallets: cached_balance += amount, available_balance += amount, version++
   - UPDATE topup_limits_tracker
3. COMMIT

---

#### POST /api/wallet/topup/webhook/razorpay

Called by Razorpay. Verify signature → credit wallet. Same logic as confirm above but with signature verification.

```
Headers: X-Razorpay-Signature: hmac-value
```

---

#### GET /api/wallet/topup/:paymentTxnId

```json
{ "success": true, "data": { "payment_txn_id": "uuid", "amount": 50000, "status": "captured", "payment_method": "upi", "captured_at": "..." } }
```

---

#### GET /api/wallet/:walletId/transactions?page=1&limit=20&txn_type=

```json
{
  "success": true,
  "data": {
    "transactions": [
      { "txn_id": "uuid", "txn_type": "debit", "txn_category": "hold_capture", "amount": 8300, "display_amount": "-₹83.00", "description": "Order ORD-20260701-9981", "reference_id": "ORD-20260701-9981", "created_at": "..." },
      { "txn_id": "uuid", "txn_type": "credit", "txn_category": "topup", "amount": 50000, "display_amount": "+₹500.00", "description": "Top-up via UPI", "created_at": "..." },
      { "txn_id": "uuid", "txn_type": "credit", "txn_category": "refund", "amount": 8300, "display_amount": "+₹83.00", "description": "Refund: Order ORD-20260630-4421 cancelled", "created_at": "..." }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 45, "has_next": true }
  }
}
```

---

### ORDERS

#### POST /api/orders/estimate

No auth required. Price estimate before booking.

```json
// Request
{
  "pickup": { "lat": 19.0596, "lng": 72.8295 },
  "dropoff": { "lat": 19.0728, "lng": 72.8826 },
  "parcel": { "weight_kg": 2.5 }
}

// Response 200
{
  "success": true,
  "data": {
    "distance_km": 3.8,
    "estimated_minutes": 25,
    "pricing": {
      "base_fare": 4000,
      "distance_fare": 3800,
      "weight_surcharge": 0,
      "platform_fee": 500,
      "total": 8300,
      "display_base": "₹40.00",
      "display_distance": "₹38.00",
      "display_weight": "₹0.00",
      "display_platform": "₹5.00",
      "display_total": "₹83.00"
    },
    "payment_methods": ["wallet", "cash", "upi"]
  }
}
```

**Pricing formula:**
```
base_fare = 4000 (₹40 flat)
distance_fare = Math.round(distance_km * 1000) (₹10/km)
weight_surcharge = weight_kg > 5 ? Math.round((weight_kg - 5) * 1500) : 0 (₹15/kg over 5kg)
platform_fee = 500 (₹5 flat)
total = base_fare + distance_fare + weight_surcharge + platform_fee
```

**Distance calculation:** Haversine formula between pickup and dropoff coordinates.

**Errors:** DISTANCE_TOO_FAR (422) if > 20km, INVALID_COORDINATES (422) if outside India bounds (lat 8-37, lng 68-97)

---

#### POST /api/orders/create

Auth required. Place an order.

```json
// Request
{
  "pickup": {
    "lat": 19.0596, "lng": 72.8295,
    "address": "Cafe Coffee Day, Bandra West, Mumbai",
    "contact_name": "Store Manager",
    "contact_phone": "9876543210"
  },
  "dropoff": {
    "lat": 19.0728, "lng": 72.8826,
    "address": "14B, Juhu Scheme, Mumbai",
    "contact_name": "Priya Sharma",
    "contact_phone": "9871234567"
  },
  "parcel": { "weight_kg": 2.5, "special_notes": "Handle with care — fragile items" },
  "payment_method": "wallet"
}

// Response 201
{
  "success": true,
  "data": {
    "order_id": "ORD-20260704-3847",
    "status": "confirmed",
    "pickup": { "lat": 19.0596, "lng": 72.8295, "address": "Cafe Coffee Day, Bandra West, Mumbai" },
    "dropoff": { "lat": 19.0728, "lng": 72.8826, "address": "14B, Juhu Scheme, Mumbai" },
    "pricing": {
      "base_fare": 4000, "distance_fare": 3800, "weight_surcharge": 0, "platform_fee": 500,
      "total": 8300, "display_total": "₹83.00"
    },
    "payment": { "method": "wallet", "hold_id": "uuid", "hold_amount": 8300 },
    "distance_km": 3.8,
    "estimated_delivery_minutes": 25,
    "dispatch_status": "searching",
    "created_at": "2026-07-04T10:00:00Z"
  }
}
```

**Logic (MUST be atomic):**
1. Validate all inputs (addresses, phone numbers, coordinates, weight)
2. Calculate price (same formula as estimate)
3. Generate order_id: `"ORD-" + YYYYMMDD + "-" + random 4 digits`
4. If payment_method = "wallet":
   a. Check wallet.available_balance >= total → else INSUFFICIENT_BALANCE
   b. Place hold:
      - INSERT wallet_holds (amount=total, reference_type='order', reference_id=order_id, expires_at=now+24h)
      - UPDATE wallets SET available_balance = available_balance - total, version = version + 1
      - Use optimistic lock (WHERE version = current_version)
5. INSERT orders record (status: 'confirmed')
6. INSERT order_events: { event_type: 'order_confirmed', title: 'Order Confirmed', description: '₹83.00 held from wallet' }
7. **Trigger dispatch** — call the existing dispatch module internally:
   - Call `dispatchService.startDispatch({ order_id, pickup, dropoff, city: 'Mumbai', customer_id, order_meta: { parcel_weight_kg, special_notes } })`
8. Update order status → 'searching'
9. INSERT order_events: { event_type: 'dispatch_started', title: 'Finding Rider' }
10. Return order confirmation to customer

**If payment_method = "cash":** Skip hold step, just create order and dispatch.

**Errors:**
- `INSUFFICIENT_BALANCE` (422): "Wallet balance too low. Add ₹XX.XX to continue"
- `INVALID_COORDINATES` (422)
- `DISTANCE_TOO_FAR` (422): "Max delivery distance is 20km"
- `WALLET_FROZEN` (403)
- `INVALID_PHONE` (400): "Contact phone must be 10 digits"

---

#### GET /api/orders/:orderId

Full order details.

```json
{
  "success": true,
  "data": {
    "order_id": "ORD-20260704-3847",
    "status": "in_transit",
    "pickup": { "lat": 19.0596, "lng": 72.8295, "address": "Cafe Coffee Day, Bandra West, Mumbai" },
    "dropoff": { "lat": 19.0728, "lng": 72.8826, "address": "14B, Juhu Scheme, Mumbai" },
    "parcel": { "weight_kg": 2.5, "special_notes": "Handle with care" },
    "pricing": { "total": 8300, "display_total": "₹83.00" },
    "payment": { "method": "wallet", "hold_id": "uuid", "status": "held" },
    "rider": {
      "rider_id": "uuid", "name": "Rajesh Kumar", "phone_masked": "98765XXXXX",
      "vehicle_type": "bike", "rating": 4.8, "current_lat": 19.065, "current_lng": 72.840, "eta_minutes": 8
    },
    "distance_km": 3.8,
    "estimated_delivery_minutes": 25,
    "can_cancel": false,
    "cancellation_fee": 2000,
    "created_at": "2026-07-04T10:00:00Z",
    "confirmed_at": "2026-07-04T10:00:01Z",
    "assigned_at": "2026-07-04T10:00:22Z",
    "picked_up_at": "2026-07-04T10:12:00Z",
    "delivered_at": null
  }
}
```

`can_cancel` logic:
- true when status is: confirmed, searching, assigned, en_route_pickup
- false when status is: arrived_pickup, picked_up, in_transit, delivered, cancelled

---

#### GET /api/orders/:orderId/status

Lightweight poll (called every 5s by app during tracking).

```json
{
  "success": true,
  "data": {
    "order_id": "ORD-20260704-3847",
    "status": "in_transit",
    "customer_message": "Your order is on the way!",
    "rider": { "name": "Rajesh Kumar", "lat": 19.068, "lng": 72.850, "eta_minutes": 6 },
    "can_cancel": false,
    "updated_at": "2026-07-04T10:20:00Z"
  }
}
```

**Customer messages by status:**
```
confirmed/searching → "Finding a rider for you..."
assigned/en_route_pickup → "{rider_name} is heading to pick up your order!"
arrived_pickup → "Rider has arrived at the pickup point!"
picked_up/in_transit → "Your order is on the way!"
delivered → "Your order has been delivered! 🎉"
cancelled → "Order cancelled"
```

---

#### GET /api/orders/:orderId/timeline

```json
{
  "success": true,
  "data": {
    "order_id": "ORD-20260704-3847",
    "events": [
      { "event_type": "order_confirmed", "title": "Order Confirmed", "description": "₹83.00 held from wallet", "created_at": "2026-07-04T10:00:01Z" },
      { "event_type": "dispatch_started", "title": "Finding Rider", "description": "Searching for nearby riders", "created_at": "2026-07-04T10:00:02Z" },
      { "event_type": "rider_assigned", "title": "Rider Assigned", "description": "Rajesh Kumar accepted", "created_at": "2026-07-04T10:00:22Z" },
      { "event_type": "rider_at_pickup", "title": "At Pickup", "description": "Rider arrived at pickup", "created_at": "2026-07-04T10:08:00Z" },
      { "event_type": "order_picked_up", "title": "Picked Up", "description": "Parcel collected", "created_at": "2026-07-04T10:12:00Z" },
      { "event_type": "order_in_transit", "title": "On the Way", "description": "Heading to delivery address", "created_at": "2026-07-04T10:12:05Z" }
    ]
  }
}
```

---

#### POST /api/orders/:orderId/cancel

```json
// Request
{ "reason": "Changed my mind" }

// Response 200 (before rider assigned — FREE)
{
  "success": true,
  "data": {
    "order_id": "ORD-20260704-3847", "status": "cancelled",
    "cancellation_fee": 0, "display_fee": "₹0.00",
    "refund_amount": 8300, "display_refund": "₹83.00",
    "refund_method": "wallet",
    "message": "Order cancelled. Full amount refunded to wallet."
  }
}

// Response 200 (after rider assigned — ₹20 FEE)
{
  "success": true,
  "data": {
    "order_id": "ORD-20260704-3847", "status": "cancelled",
    "cancellation_fee": 2000, "display_fee": "₹20.00",
    "refund_amount": 6300, "display_refund": "₹63.00",
    "refund_method": "wallet",
    "message": "Order cancelled. ₹63.00 refunded (₹20.00 cancellation fee)."
  }
}
```

**Cancellation rules:**
| Order Status | Fee | Wallet Action |
|-------------|-----|---------------|
| confirmed / searching | ₹0 | Release full hold |
| assigned / en_route_pickup | ₹20 (2000 paisa) | Capture 2000 from hold, release rest |
| arrived_pickup / picked_up / in_transit / delivered | ❌ BLOCKED | Nothing |

**Logic:**
1. Check order can be cancelled (status check)
2. Determine fee (0 or 2000 based on status)
3. If fee = 0: release hold entirely (wallet.available_balance += hold_amount)
4. If fee > 0:
   - Capture fee from hold: INSERT wallet_transaction(debit, cancellation_fee, 2000)
   - Release remainder: wallet.available_balance += (hold_amount - 2000)
   - Update wallet_holds.status → 'released' (partial capture tracked separately)
5. Update order: status → 'cancelled', cancelled_at = now, cancel_reason
6. If rider was assigned: notify dispatch service to cancel rider's delivery
7. Insert order_event: "Order Cancelled"
8. Socket.IO: emit `order_cancelled` to customer

**Errors:**
- `CANCEL_NOT_ALLOWED` (409): "Cannot cancel after rider has arrived at pickup"
- `ORDER_ALREADY_CANCELLED` (409)
- `ORDER_ALREADY_DELIVERED` (409)

---

#### POST /api/orders/:orderId/rate

```json
// Request
{ "delivery_rating": 5, "rider_rating": 4, "comments": "Quick delivery" }

// Response 200
{ "success": true, "data": { "order_id": "ORD-20260704-3847", "delivery_rating": 5, "rider_rating": 4, "message": "Thank you for your feedback!" } }
```

- Validation: order must be 'delivered', ratings 1-5, one per order
- Update rider's average rating in riders table

---

#### GET /api/orders?page=1&limit=20&status=

Order history list.

```json
{
  "success": true,
  "data": {
    "orders": [
      {
        "order_id": "ORD-20260704-3847", "status": "delivered",
        "pickup_address": "Cafe Coffee Day, Bandra West", "dropoff_address": "14B, Juhu Scheme",
        "total_amount": 8300, "display_total": "₹83.00", "distance_km": 3.8,
        "rider_name": "Rajesh Kumar",
        "created_at": "2026-07-04T10:00:00Z", "delivered_at": "2026-07-04T10:32:00Z",
        "is_rated": true
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 12, "has_next": false }
  }
}
```

---

### SAVED ADDRESSES

#### GET /api/customer/addresses

```json
{
  "success": true,
  "data": {
    "addresses": [
      { "id": "uuid", "label": "Home", "address": "14B, Juhu Scheme, Mumbai", "lat": 19.0728, "lng": 72.8826, "contact_name": "Priya", "contact_phone": "9871234567", "is_default": true },
      { "id": "uuid", "label": "Office", "address": "BKC, Mumbai", "lat": 19.059, "lng": 72.865, "contact_name": "Priya Sharma", "contact_phone": "9871234567", "is_default": false }
    ]
  }
}
```

#### POST /api/customer/addresses

```json
// Request
{ "label": "Mom's Place", "address": "42, Dadar West", "lat": 19.017, "lng": 72.842, "contact_name": "Mrs Sharma", "contact_phone": "9898989898" }
// Response 201
{ "success": true, "data": { "id": "uuid", "label": "Mom's Place", "message": "Address saved" } }
```

#### PUT /api/customer/addresses/:id

Update a saved address.

#### DELETE /api/customer/addresses/:id

```json
{ "success": true, "data": { "message": "Address deleted" } }
```

---

### DISPATCH INTEGRATION (How order status syncs with existing dispatch module)

When the dispatch module fires events (rider assigned, delivered, cancelled), it must update the customer's order. Add an internal event listener or direct service call:

```typescript
// In orders.service.ts — called by dispatch module on state changes
async handleDispatchEvent(event: {
  order_id: string;
  event_type: string;
  rider_id?: string;
  rider_name?: string;
  rider_phone?: string;
  rider_vehicle?: string;
  rider_rating?: number;
}) {
  switch(event.event_type) {
    case 'rider_assigned':
      // Update order: status='assigned', assigned_at, rider_* fields
      // Insert order_event
      // Emit socket: rider_assigned
      break;
    case 'en_route_pickup':
      // Update order: status='en_route_pickup'
      break;
    case 'arrived_pickup':
      // Update order: status='arrived_pickup'
      // Emit socket: rider_at_pickup
      break;
    case 'picked_up':
      // Update order: status='picked_up', picked_up_at
      // Emit socket: order_picked_up
      break;
    case 'in_transit':
      // Update order: status='in_transit'
      // Emit socket: order_in_transit
      break;
    case 'delivered':
      // Update order: status='delivered', delivered_at
      // CAPTURE WALLET HOLD (critical!)
      // Emit socket: order_delivered
      break;
    case 'redispatching':
      // Update order: status='searching', clear rider fields
      // Emit socket: rider_reassigned
      break;
    case 'cancelled_by_rider':
      // If terminal (store_closed): cancel order, release hold, refund
      // Emit socket: order_cancelled
      break;
    case 'no_rider':
      // Keep status='searching', emit message "Taking longer..."
      break;
  }
}
```

**On 'delivered' — Wallet Hold Capture (CRITICAL):**
```typescript
async captureOrderPayment(orderId: string) {
  const order = await this.orderRepo.findOne({ where: { order_id: orderId } });
  if (!order.hold_id || order.payment_method !== 'wallet') return;

  // Capture hold
  const hold = await this.holdRepo.findOne({ where: { id: order.hold_id } });
  
  BEGIN TRANSACTION:
    // 1. Insert wallet_transaction (debit, hold_capture, order.total_amount)
    // 2. Update wallets: cached_balance -= order.total_amount, version++
    // 3. Update wallet_holds: status='captured', captured_at=now
    // 4. Insert order_event: "Payment Charged ₹83.00"
  COMMIT
}
```

---

### SOCKET.IO — Customer Events

Add customer rooms to the existing Socket.IO gateway:

On customer connect (JWT with type='customer'):
- Join room: `customer:{customer_id}`

**Events emitted TO customer:**

| Event | Payload |
|-------|---------|
| `dispatch_update` | `{ order_id, status, message }` |
| `rider_assigned` | `{ order_id, rider_name, rider_vehicle, eta_minutes, rider_lat, rider_lng }` |
| `rider_location` | `{ order_id, lat, lng, eta_minutes }` — every 5s during active delivery |
| `rider_at_pickup` | `{ order_id, message }` |
| `order_picked_up` | `{ order_id, message }` |
| `order_in_transit` | `{ order_id, message, eta_minutes }` |
| `order_delivered` | `{ order_id, delivered_at, message }` |
| `order_cancelled` | `{ order_id, reason, refund_amount, display_refund }` |
| `rider_reassigned` | `{ order_id, message }` |

**Rider location broadcast:**
When a rider updates their GPS (via POST /api/dispatch/location or socket location_update), if they are on_trip with an active order → look up the customer_id for that order → emit `rider_location` to `customer:{customer_id}` room.

---

### BACKGROUND WORKERS (Add to existing BullMQ)

#### Hold Expiry Worker
- **Schedule:** Every 5 minutes
- Find wallet_holds WHERE status='active' AND expires_at < NOW()
- For each: release hold (available_balance += amount), set status='expired'
- If associated with an order: cancel that order, insert event "Order expired — no payment"

#### Payment Timeout Worker
- **Schedule:** Every 5 minutes
- Find payment_transactions WHERE status='pending' AND expires_at < NOW()
- Mark as 'failed'

---

## Business Rules Summary

| Rule | Value |
|------|-------|
| All money | Integer, paisa (₹1 = 100) |
| Price: base fare | 4000 paisa (₹40) |
| Price: per km | 1000 paisa (₹10) |
| Price: weight surcharge | 1500 paisa per kg over 5kg (₹15) |
| Price: platform fee | 500 paisa (₹5) |
| Max distance | 20 km |
| Cancel fee (before assignment) | 0 |
| Cancel fee (after assignment) | 2000 paisa (₹20) |
| Cancel blocked | After arrived_pickup |
| Wallet hold duration | 24 hours |
| Top-up daily limit | 1000000 paisa (₹10,000) |
| Top-up monthly limit | 10000000 paisa (₹1,00,000) |
| OTP expiry | 5 minutes |
| OTP lock | 3 wrong = 15 min lock |
| Coordinates (India) | lat: 8-37, lng: 68-97 |
| Optimistic lock | wallets.version field, retry 3x |
| Idempotency | All wallet mutations use unique key |

---

## Dev Mode Shortcuts

For development/testing without real payment gateway:
1. `POST /api/wallet/topup/confirm` — manually confirm pending top-up (bypass webhook)
2. OTP: accept "1234" for any number
3. Auto-create wallet with ₹500 balance for new customers (seed)
4. Seed 3 test customers with orders and transactions

---

## Payment Method Extension Note

Order placement must support multiple payment methods from day one:

```text
payment_method: "cash" | "wallet" | "online"
```

Implementation should keep payment handling extensible instead of hard-coding only wallet payment.

Recommended behavior:

| Payment Method | Order Placement Behavior | Delivery/Cancellation Behavior |
|----------------|--------------------------|--------------------------------|
| `cash` | Do not place a wallet hold. Create the order and start dispatch. Payment can remain pending/collect-on-delivery. | Mark payment collected/settled through future cash collection logic. Cancellation does not require wallet refund unless future mixed payments are added. |
| `wallet` | Check wallet availability and place a wallet hold atomically with order creation. | Capture the hold only after delivery. Release or partially capture/release based on cancellation rules. |
| `online` | Create a payment transaction / gateway order first. Keep order in `payment_pending` or equivalent state until payment is confirmed. Start dispatch only after successful payment confirmation. | Capture/settle through the gateway transaction. Refund through payment transaction flow on eligible cancellation. |

Suggested order/payment fields for future extensibility:

```text
payment_method
payment_status
payment_reference_id
hold_id
```

Suggested service shape:

```text
preparePaymentForOrder()
capturePaymentForDeliveredOrder()
refundOrReleasePaymentForCancelledOrder()
```

This keeps the system easy to extend later for UPI, card, COD, split wallet + online payment, coupons, credits, or other payment providers.

---

## IMPORTANT

1. Wallet hold MUST be placed atomically with order creation — if hold fails, order fails
2. Hold capture ONLY on delivery confirmation — never before
3. Use optimistic locking (version field) on ALL wallet balance updates
4. Wallet balance can NEVER go negative (DB CHECK constraint enforces this)
5. Price calculation must be identical between /estimate and /create
6. Insert order_events for EVERY status change (timeline requires it)
7. Socket.IO rider_location must forward to customer room every 5s during delivery
8. Cancellation fee logic must be exact per the rules table
9. The /api/dispatch/start call to trigger dispatch uses YOUR EXISTING dispatch module — don't rebuild it

## PROMPT END
