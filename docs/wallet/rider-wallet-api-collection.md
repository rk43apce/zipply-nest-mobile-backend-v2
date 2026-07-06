 # Rider App — Wallet & Payment API Collection

Base URL: `http://localhost:3000` (same as existing rider app)

All requests require:
- Header: `Authorization: Bearer {{token}}` (existing auth token from OTP verify)
- Header: `X-Device-Id: <device_unique_id>`
- Content-Type: `application/json`

All amounts are in **paisa** (₹1 = 100 paisa). All responses follow the standard envelope.

---

## IMPORTANT: Existing System Notes

> **Authentication & Authorization is ALREADY built.** Do NOT rebuild it from scratch.
> The rider app already has (see `docs/rider-app-api-collection.json`):
> - `POST /api/auth/otp/send` — Send OTP
> - `POST /api/auth/otp/verify` — Verify OTP (returns token)
> - `POST /api/auth/token/refresh` — Refresh token
> - Rider profile, onboarding, dispatch, delivery lifecycle, earnings, history
> 
> **What to ADD (not replace) to the existing auth:**
> 1. Single-device enforcement: On login (OTP verify), invalidate any previous session for this rider. Store only ONE active session per rider.
> 2. Session validation middleware: On every API call, check if the token still belongs to the active session. If not, return `FORCE_LOGOUT`.
> 3. Force-logout push notification: When a new login invalidates an old session, send a push to the old device via existing FCM setup.
>
> **New module to build:** Wallet & Payment (sections 2-8 below). These are new routes under `/api/rider/wallet/...`
>
> **Rule:** Do NOT modify existing login/OTP/token generation logic. Only ADD the single-session check as a middleware layer on top of what exists. All existing endpoints (profile, dispatch, delivery, earnings) must continue working exactly as before.

---

## Standard Response Envelope

```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

Error response:
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Wallet balance too low for requested withdrawal"
  }
}
```

---

## 1. Session & Authentication (EXTEND EXISTING — DO NOT REBUILD)

> The login, OTP, JWT generation, and refresh flow already exist. Only add the single-device enforcement layer described below.

### 1.1 Single-Device Enforcement (ADD to existing login flow)

After existing OTP verification succeeds and token is generated, ADD this step:
- Store/replace the active session record for this user
- If a previous session existed on a different device, mark it as invalidated
- Send a push notification to the old device with `force_logout` payload

The existing login response should ADD these fields to what it already returns:

**Additional fields in login response:**
```json
{
  "previous_device_logged_out": true,
  "previous_device": "Redmi Note 10"
}
```

### 1.2 Session Validation Middleware (ADD as middleware on ALL endpoints)

Add this check at the top of every protected API call. If the token doesn't match the current active session, return 401 with FORCE_LOGOUT.

**GET** `/api/auth/session/validate`

**Response (200) — Valid:**
```json
{
  "success": true,
  "data": { "valid": true }
}
```

**Response (401) — Force Logout:**
```json
{
  "success": false,
  "error": {
    "code": "FORCE_LOGOUT",
    "message": "Your account is now active on another device. Please login again to continue here."
  }
}
```

### 1.3 Logout (likely already exists — just ensure session record is cleared)

**POST** `/api/auth/logout`

**Response (200):**
```json
{
  "success": true,
  "data": { "logged_out": true }
}
```

---

## 2. Wallet — Balance & Info

### 2.1 Get Wallet Balance

**GET** `/api/rider/wallet/{{riderId}}`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "wallet_id": 12,
    "rider_id": 5002,
    "cached_balance": 35000,
    "available_balance": 35000,
    "display_balance": "₹350.00",
    "display_available": "₹350.00",
    "currency": "INR",
    "status": "active",
    "is_blocked": false,
    "blocked_reason": null,
    "negative_threshold": -10000,
    "display_threshold": "-₹100.00"
  }
}
```

**Response when blocked:**
```json
{
  "success": true,
  "data": {
    "wallet_id": 12,
    "rider_id": 5002,
    "cached_balance": -12500,
    "available_balance": -12500,
    "display_balance": "-₹125.00",
    "display_available": "-₹125.00",
    "currency": "INR",
    "status": "active",
    "is_blocked": true,
    "blocked_reason": "Balance below threshold (-₹100). Top up to accept rides.",
    "negative_threshold": -10000,
    "display_threshold": "-₹100.00"
  }
}
```

---

## 3. Wallet — Top-Up

### 3.1 Initiate Top-Up

Creates a payment order with the gateway (Razorpay). Returns checkout details for the app to show the payment sheet.

**POST** `/api/rider/wallet/{{riderId}}/topup/initiate`

**Request:**
```json
{
  "amount": 20000,
  "gateway": "razorpay"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "payment_txn_id": 456,
    "gateway_order_id": "order_NxR5f8k2mAbc12",
    "amount": 20000,
    "currency": "INR",
    "gateway": "razorpay",
    "key_id": "rzp_live_xxxxxxxxxx",
    "prefill": {
      "name": "Ramesh Kumar",
      "contact": "+919876543210"
    }
  }
}
```

### 3.2 Confirm Top-Up (Gateway Callback)

Called after Razorpay payment succeeds on client side. Verifies signature and credits wallet.

**POST** `/api/rider/wallet/{{riderId}}/topup/confirm`

**Request:**
```json
{
  "payment_txn_id": 456,
  "gateway_payment_id": "pay_NxR5abc123def",
  "gateway_signature": "d4a8f2e1b3c5..."
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "wallet_txn_id": 789,
    "credited_amount": 20000,
    "new_balance": 55000,
    "display_new_balance": "₹550.00",
    "is_blocked": false,
    "was_unblocked": true
  }
}
```

**Error — Invalid Signature (400):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_SIGNATURE",
    "message": "Payment signature verification failed"
  }
}
```

---

## 4. Wallet — Withdrawal

### 4.1 Get Withdrawal Info

Returns available balance and configured limits before showing withdrawal form.

**GET** `/api/rider/wallet/{{riderId}}/withdraw/info`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "available_for_withdrawal": 35000,
    "display_available": "₹350.00",
    "min_withdrawal": 1000,
    "max_daily_withdrawal": 5000000,
    "daily_withdrawn_today": 10000,
    "daily_remaining": 4990000,
    "cooling_period_active": false,
    "payout_methods": [
      { "type": "upi", "value": "ramesh@upi", "is_default": true },
      { "type": "bank_transfer", "account_last4": "4567", "ifsc": "SBIN0001234", "is_default": false }
    ]
  }
}
```

### 4.2 Initiate Withdrawal

**POST** `/api/rider/wallet/{{riderId}}/withdraw`

**Request:**
```json
{
  "amount": 20000,
  "payout_method": "upi",
  "idempotency_key": "withdraw_5002_20240615_abc123"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "withdrawal_id": 101,
    "amount": 20000,
    "payout_method": "upi",
    "payout_to": "ramesh@upi",
    "status": "processing",
    "new_balance": 15000,
    "display_new_balance": "₹150.00",
    "estimated_arrival": "2-4 hours"
  }
}
```

**Error — Insufficient Balance (422):**
```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Cannot withdraw more than available balance (₹350.00)"
  }
}
```

**Error — Cooling Period (422):**
```json
{
  "success": false,
  "error": {
    "code": "COOLING_PERIOD_ACTIVE",
    "message": "Recent top-up funds available for withdrawal after 30 minutes"
  }
}
```

### 4.3 Get Withdrawal Status

**GET** `/api/rider/wallet/{{riderId}}/withdraw/{{withdrawal_id}}`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "withdrawal_id": 101,
    "amount": 20000,
    "payout_method": "upi",
    "status": "completed",
    "initiated_at": "2024-06-15T10:30:00Z",
    "completed_at": "2024-06-15T12:15:00Z"
  }
}
```

---

## 5. Transaction History

### 5.1 Get Transactions

**GET** `/api/rider/wallet/{{riderId}}/transactions?page=1&per_page=20&type=all`

Query params: `type` = `all` | `credit` | `debit`, `page`, `per_page`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "txn_id": 789,
        "txn_type": "credit",
        "category": "topup",
        "amount": 20000,
        "display_amount": "+₹200.00",
        "running_balance": 55000,
        "description": "Top-up via Razorpay",
        "reference_type": "payment_transaction",
        "reference_id": "456",
        "created_at": "2024-06-15T10:30:00Z"
      },
      {
        "txn_id": 788,
        "txn_type": "debit",
        "category": "purchase",
        "amount": 4000,
        "display_amount": "-₹40.00",
        "running_balance": 35000,
        "description": "Platform commission (20%) — Trip #283976",
        "reference_type": "trip",
        "reference_id": "283976",
        "created_at": "2024-06-15T09:45:00Z"
      },
      {
        "txn_id": 787,
        "txn_type": "debit",
        "category": "purchase",
        "amount": 20000,
        "display_amount": "-₹200.00",
        "running_balance": 39000,
        "description": "Withdrawal to UPI",
        "reference_type": "withdrawal",
        "reference_id": "101",
        "created_at": "2024-06-15T08:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "per_page": 20,
      "total": 45,
      "total_pages": 3
    }
  }
}
```

---

## 6. Cash Trip — Collection & Commission

### 6.1 Get Active Cash Trip (if any)

Called on rider home screen to show pending cash collection.

**GET** `/api/rider/trips/{{riderId}}/active-cash`

**Response (200) — Active trip:**
```json
{
  "success": true,
  "data": {
    "trip_id": 283976,
    "customer_name": "Priya S.",
    "payment_method": "cash",
    "original_fare": 20000,
    "discounted_fare": 17000,
    "discount_amount": 3000,
    "display_collect": "₹170.00",
    "display_original": "₹200.00",
    "display_discount": "₹30.00 (coupon applied by customer)",
    "status": "pending",
    "created_at": "2024-06-15T14:20:00Z"
  }
}
```

**Response (200) — No active trip:**
```json
{
  "success": true,
  "data": null
}
```

### 6.2 Confirm Cash Collection

Rider confirms they collected cash from customer. Triggers commission deduction.

**POST** `/api/rider/trips/{{riderId}}/{{trip_id}}/confirm-cash`

**Request:**
```json
{
  "trip_id": 283976,
  "idempotency_key": "cash_confirm_283976_abc123"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "trip_id": 283976,
    "cash_collected": 17000,
    "display_collected": "₹170.00",
    "commission_amount": 4000,
    "commission_rate_percent": "20%",
    "display_commission": "₹40.00",
    "commission_note": "Commission calculated on original fare (₹200.00), not discounted fare",
    "new_wallet_balance": -5500,
    "display_new_balance": "-₹55.00",
    "is_blocked": false,
    "status": "completed"
  }
}
```

**Response — Rider Blocked After Commission (200):**
```json
{
  "success": true,
  "data": {
    "trip_id": 283977,
    "cash_collected": 17000,
    "commission_amount": 4000,
    "new_wallet_balance": -12500,
    "display_new_balance": "-₹125.00",
    "is_blocked": true,
    "blocked_message": "Your wallet is below -₹100. Please top up to continue accepting rides.",
    "status": "completed"
  }
}
```

---

## 7. Ride Acceptance Check

### 7.1 Check Ride Eligibility

Called before showing a new ride request to the rider. If blocked, don't show the ride.

**GET** `/api/rider/eligibility/{{riderId}}`

**Response (200) — Eligible:**
```json
{
  "success": true,
  "data": {
    "can_accept_rides": true,
    "wallet_balance": 5000,
    "is_blocked": false
  }
}
```

**Response (200) — Blocked:**
```json
{
  "success": true,
  "data": {
    "can_accept_rides": false,
    "wallet_balance": -12500,
    "is_blocked": true,
    "blocked_reason": "Wallet balance below threshold (-₹100)",
    "action_required": "topup",
    "minimum_topup_needed": 2500,
    "display_minimum": "₹25.00"
  }
}
```

---

## 8. Device & Security

### 8.1 Register Device Fingerprint

Called on app launch / login. Detects shared devices.

**POST** `/api/rider/device/{{riderId}}/register`

**Request:**
```json
{
  "device_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "device_meta": {
    "model": "Samsung Galaxy S21",
    "os": "Android 13",
    "app_version": "2.1.0",
    "screen_resolution": "1080x2400"
  }
}
```

**Response (200) — Clean:**
```json
{
  "success": true,
  "data": {
    "registered": true,
    "is_flagged": false,
    "shared_accounts": 0
  }
}
```

**Response (200) — Shared Device Detected:**
```json
{
  "success": true,
  "data": {
    "registered": true,
    "is_flagged": true,
    "shared_accounts": 2,
    "warning": "This device is associated with multiple accounts. Some features may require additional verification."
  }
}
```

---

## 9. Notifications (Push Payload Formats)

These are push notification payloads the app should handle:

### 9.1 Force Logout

```json
{
  "type": "force_logout",
  "title": "Logged in elsewhere",
  "body": "Your account was accessed from Samsung Galaxy A52. You've been logged out from this device.",
  "action": "navigate_to_login"
}
```

### 9.2 Wallet Blocked

```json
{
  "type": "wallet_blocked",
  "title": "Wallet blocked",
  "body": "Your balance is -₹125.00. Top up at least ₹25 to accept rides.",
  "action": "navigate_to_topup",
  "data": { "minimum_topup": 2500 }
}
```

### 9.3 Wallet Unblocked

```json
{
  "type": "wallet_unblocked",
  "title": "You're back online!",
  "body": "Your wallet is cleared. You can now accept rides.",
  "action": "navigate_to_home"
}
```

### 9.4 Commission Deducted

```json
{
  "type": "commission_deducted",
  "title": "Commission deducted",
  "body": "₹40.00 commission deducted for Trip #283976. Balance: ₹350.00",
  "action": "navigate_to_transactions",
  "data": { "trip_id": 283976, "amount": 4000 }
}
```

### 9.5 Withdrawal Completed

```json
{
  "type": "withdrawal_completed",
  "title": "Withdrawal successful",
  "body": "₹200.00 transferred to ramesh@upi",
  "action": "navigate_to_transactions",
  "data": { "withdrawal_id": 101 }
}
```

### 9.6 Withdrawal Failed

```json
{
  "type": "withdrawal_failed",
  "title": "Withdrawal failed",
  "body": "₹200.00 withdrawal to ramesh@upi failed. Amount restored to wallet.",
  "action": "navigate_to_wallet",
  "data": { "withdrawal_id": 101 }
}
```

---

## 10. Error Codes Reference

| Code | HTTP | When |
|------|------|------|
| `FORCE_LOGOUT` | 401 | Session invalidated — logged in on another device |
| `TOKEN_EXPIRED` | 401 | JWT token has expired |
| `WALLET_FROZEN` | 403 | Admin froze the wallet |
| `RIDER_BLOCKED` | 403 | Wallet below negative threshold, cannot accept rides |
| `INSUFFICIENT_BALANCE` | 422 | Withdrawal amount exceeds positive balance |
| `WITHDRAWAL_LIMIT_EXCEEDED` | 422 | Daily withdrawal limit reached |
| `WITHDRAWAL_BELOW_MINIMUM` | 422 | Amount below minimum withdrawal (₹10) |
| `COOLING_PERIOD_ACTIVE` | 422 | Recent top-up funds not yet available |
| `INVALID_SIGNATURE` | 400 | Gateway payment signature mismatch |
| `INVALID_AMOUNT` | 400 | Amount is 0, negative, or exceeds max |
| `DUPLICATE_REQUEST` | 409 | Idempotency key already processed |
| `TRIP_PAYMENT_NOT_FOUND` | 404 | Trip ID doesn't exist |
| `INVALID_TRIP_STATE` | 422 | Trip not in valid state for this action |
| `OPTIMISTIC_LOCK_CONFLICT` | 409 | Concurrent update detected, retry |
| `PAYOUT_FAILED` | 502 | Bank/UPI payout failed |

---

## 11. Integration Notes for Flutter/App Developer

**⚠️ CRITICAL: Do NOT rebuild authentication. It already exists. Only ADD the wallet module and the single-device session check.**

1. **Session check on every API call**: Add a middleware/interceptor. Before processing any API response, check if error code is `FORCE_LOGOUT`. If yes, clear local storage, show "logged in elsewhere" dialog, navigate to login. This is the ONLY change to existing auth flow.

2. **Amounts in paisa**: All amounts from API are in paisa. Display as `₹{amount/100}` with 2 decimal places.

3. **Idempotency keys**: Generate unique keys for all mutation requests (topup confirm, withdrawal, cash confirm). Format: `{action}_{rider_id}_{timestamp}_{random}`. Store locally until confirmed.

4. **Negative balance display**: When `cached_balance < 0`, show in red. When `is_blocked = true`, show a persistent banner: "Top up ₹X to accept rides".

5. **Commission explanation**: After cash collection, show a breakdown: "You collected ₹170 → Commission ₹40 (20% of original ₹200) → Net impact on wallet: -₹40"

6. **Polling for withdrawal status**: After initiating withdrawal, poll `GET /rider/wallet/withdraw/{id}` every 30 seconds until status is `completed` or `failed`.

7. **Device ID**: Use the same device ID that the existing auth system already sends. Do NOT generate a new one. Send it in `X-Device-Id` header on all requests.

8. **Offline handling**: Cache last known wallet balance locally. Show cached value with "Last updated X min ago" when offline. Sync on reconnect.

9. **Top-up flow (Razorpay)**:
   - Call `POST /api/rider/wallet/{{riderId}}/topup/initiate` → get order_id
   - Open Razorpay checkout with order_id
   - On success callback → call `POST /api/rider/wallet/{{riderId}}/topup/confirm` with payment_id + signature
   - On failure → show retry option

10. **Ride acceptance gate**: Before showing incoming ride notification, call `GET /api/rider/eligibility/{{riderId}}`. If `can_accept_rides = false`, show "Top up required" screen instead of the ride request.

11. **Wallet module is NEW**: Create a new module/folder for wallet (e.g. `lib/features/wallet/`). Don't mix it into existing ride/auth code. Use the existing API client/interceptor pattern the app already has.
