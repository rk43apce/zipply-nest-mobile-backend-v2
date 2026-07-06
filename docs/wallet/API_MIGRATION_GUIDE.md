# 📋 API Endpoint Migration Guide

## Side-by-Side Comparison

### Wallet Balance

| Purpose | Before | After | Frontend Change |
|---------|--------|-------|-----------------|
| Get wallet | `GET /api/wallet/{id}` | `GET /api/rider/wallet/{riderId}` | Update URL prefix |

**Request:**
```bash
# Before
GET /api/wallet/5002

# After (Rider)
GET /api/rider/wallet/90c2eb74-5288-403e-894f-8b55d68c7aa5

# After (Customer - NEW)
GET /api/customer/wallet/660e8400-e29b-41d4-a716-446655440001
```

**Response (Same format):**
```json
{
  "success": true,
  "data": {
    "wallet_id": "...",
    "rider_id": "...",  // or customer_id for customer
    "cached_balance": 35000,
    "display_balance": "₹350.00",
    "is_blocked": false
  }
}
```

✅ No response format change. Just update URL.

---

### Transactions

| Purpose | Before | After |
|---------|--------|-------|
| List transactions | `GET /api/wallet/{id}/transactions` | `GET /api/rider/wallet/{riderId}/transactions` |

**Request:**
```bash
# Before
GET /api/wallet/5002/transactions?page=1&per_page=20

# After
GET /api/rider/wallet/5002/transactions?page=1&per_page=20
```

**Response (Same):**
```json
{
  "success": true,
  "data": {
    "transactions": [ ... ],
    "pagination": { ... }
  }
}
```

✅ No response format change. Just update URL.

---

### Top-Up: Initiate

| Purpose | Before | After |
|---------|--------|-------|
| Initiate topup | `POST /api/wallet/{id}/topup/initiate` | `POST /api/rider/wallet/{riderId}/topup/initiate` |

**Request:**
```bash
# Before
POST /api/wallet/5002/topup/initiate
{ "amount": 20000, "gateway": "razorpay" }

# After
POST /api/rider/wallet/5002/topup/initiate
{ "amount": 20000, "gateway": "razorpay" }
```

**Response (Same):**
```json
{
  "success": true,
  "data": {
    "payment_txn_id": 456,
    "gateway_order_id": "order_...",
    "key_id": "rzp_live_..."
  }
}
```

✅ Request/response unchanged. Just update URL.

---

### Top-Up: Confirm

| Purpose | Before | After |
|---------|--------|-------|
| Confirm topup | `POST /api/wallet/{id}/topup/confirm` | `POST /api/rider/wallet/{riderId}/topup/confirm` |

**Request:**
```bash
# Before
POST /api/wallet/5002/topup/confirm
{
  "payment_txn_id": 456,
  "gateway_payment_id": "pay_...",
  "gateway_signature": "..."
}

# After
POST /api/rider/wallet/5002/topup/confirm
{
  "payment_txn_id": 456,
  "gateway_payment_id": "pay_...",
  "gateway_signature": "..."
}
```

**Response (Same):**
```json
{
  "success": true,
  "data": {
    "wallet_txn_id": 789,
    "credited_amount": 20000,
    "new_balance": 55000
  }
}
```

✅ No changes needed except URL.

---

### Withdrawal: Get Info

| Purpose | Before | After |
|---------|--------|-------|
| Check withdrawal limits | N/A (NEW) | `GET /api/rider/wallet/{riderId}/withdraw/info` |

**Request:**
```bash
# NEW endpoint
GET /api/rider/wallet/5002/withdraw/info
```

**Response:**
```json
{
  "success": true,
  "data": {
    "available_for_withdrawal": 35000,
    "display_available": "₹350.00",
    "min_withdrawal": 1000,
    "max_daily_withdrawal": 5000000,
    "daily_withdrawn_today": 10000,
    "payout_methods": [ ... ]
  }
}
```

✨ NEW feature - add to your app.

---

### Withdrawal: Initiate

| Purpose | Before | After |
|---------|--------|-------|
| Start withdrawal | N/A (NEW) | `POST /api/rider/wallet/{riderId}/withdraw` |

**Request:**
```bash
POST /api/rider/wallet/5002/withdraw
{
  "amount": 20000,
  "payout_method": "upi",
  "idempotency_key": "withdraw_5002_20240615_abc123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "withdrawal_id": 101,
    "amount": 20000,
    "status": "processing",
    "new_balance": 15000,
    "estimated_arrival": "2-4 hours"
  }
}
```

✨ NEW feature - add to your app.

---

### Withdrawal: Get Status

| Purpose | Before | After |
|---------|--------|-------|
| Check withdrawal status | N/A (NEW) | `GET /api/rider/wallet/{riderId}/withdraw/{withdrawalId}` |

**Request:**
```bash
GET /api/rider/wallet/5002/withdraw/101
```

**Response:**
```json
{
  "success": true,
  "data": {
    "withdrawal_id": 101,
    "amount": 20000,
    "status": "completed",
    "initiated_at": "...",
    "completed_at": "..."
  }
}
```

✨ NEW feature - add to your app.

---

### Eligibility Check

| Purpose | Before | After |
|---------|--------|-------|
| Check if can accept rides | N/A (NEW) | `GET /api/rider/wallet/{riderId}/eligibility` |

**Request:**
```bash
GET /api/rider/wallet/5002/eligibility
```

**Response (Can Accept):**
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

**Response (Blocked):**
```json
{
  "success": true,
  "data": {
    "can_accept_rides": false,
    "wallet_balance": -12500,
    "is_blocked": true,
    "blocked_reason": "Wallet balance below threshold",
    "action_required": "topup",
    "minimum_topup_needed": 2500
  }
}
```

✨ NEW feature - gate ride acceptance with this.

---

### Cash Collection

| Purpose | Before | After |
|---------|--------|-------|
| Confirm cash trip | N/A (NEW) | `POST /api/rider/wallet/{riderId}/{tripId}/confirm-cash` |

**Request:**
```bash
POST /api/rider/wallet/5002/283976/confirm-cash
{
  "trip_id": 283976,
  "idempotency_key": "cash_confirm_283976_abc123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "trip_id": 283976,
    "cash_collected": 17000,
    "commission_amount": 4000,
    "new_wallet_balance": -5500,
    "is_blocked": false
  }
}
```

✨ NEW feature - add to cash collection flow.

---

## Implementation Checklist

### Tier 1: Critical (Do First)
- [ ] Update `/api/wallet/` → `/api/rider/wallet/` in existing wallet service
- [ ] Test existing endpoints with new URLs
- [ ] Add HTTP interceptor for `FORCE_LOGOUT` error (401)

### Tier 2: New Rider Features
- [ ] Add eligibility check before showing rides
- [ ] Add withdrawal flow (info → initiate → status)
- [ ] Add cash collection confirmation
- [ ] Update topup endpoints with new URLs

### Tier 3: Customer Features  
- [ ] Create customer wallet service
- [ ] Add customer wallet screen
- [ ] Add customer transaction history
- [ ] Test customer endpoints

### Tier 4: Polish
- [ ] Add session validation interceptor
- [ ] Handle all error codes
- [ ] Add offline caching
- [ ] Add push notification handlers

---

## Code Migration Examples

### Example 1: Balance Service

**Before:**
```typescript
// services/wallet.service.ts
getBalance(riderId: string) {
  return this.http.get(`/api/wallet/${riderId}`);
}
```

**After:**
```typescript
// services/wallet.service.ts
getBalance(riderId: string) {
  return this.http.get(`/api/rider/wallet/${riderId}`);
}

// NEW: Customer balance
getCustomerBalance(customerId: string) {
  return this.http.get(`/api/customer/wallet/${customerId}`);
}
```

### Example 2: Component Usage

**Before:**
```typescript
// components/wallet.component.ts
this.walletService.getBalance(5002).subscribe(response => {
  this.balance = response.data.display_balance;
});
```

**After:**
```typescript
// components/rider-wallet.component.ts (no change to usage)
this.walletService.getBalance(this.riderId).subscribe(response => {
  this.balance = response.data.display_balance;
});

// components/customer-wallet.component.ts (NEW)
this.customerWalletService.getCustomerBalance(this.customerId).subscribe(response => {
  this.balance = response.data.display_balance;
});
```

### Example 3: HTTP Interceptor (NEW)

```typescript
// interceptors/force-logout.interceptor.ts
import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable()
export class ForceLogoutInterceptor implements HttpInterceptor {
  
  constructor(private auth: AuthService, private router: Router) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return next.handle(req).pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.error?.error?.code === 'FORCE_LOGOUT') {
          // Handle force logout
          localStorage.clear();
          alert('Your account is now active on another device');
          this.router.navigate(['/auth/login']);
        }
        return throwError(error);
      })
    );
  }
}

// Add to app.module.ts providers
providers: [
  { provide: HTTP_INTERCEPTORS, useClass: ForceLogoutInterceptor, multi: true }
]
```

### Example 4: Eligibility Gate (NEW)

```typescript
// In ride-request.component.ts or service

async checkEligibilityBeforeShowingRide(ride: RideOffer) {
  try {
    const eligibility = await this.walletService
      .checkEligibility(this.riderId)
      .toPromise();

    if (eligibility.data.can_accept_rides) {
      // Show ride to rider
      this.onNewRideArrived(ride);
    } else {
      // Show topup screen
      this.showTopupRequiredDialog(
        eligibility.data.minimum_topup_needed,
        eligibility.data.display_minimum
      );
    }
  } catch (error) {
    console.error('Could not check eligibility:', error);
    // Default: allow (fail open)
    this.onNewRideArrived(ride);
  }
}
```

---

## Response Format Reference

All endpoints follow the same envelope:

**Success:**
```json
{
  "success": true,
  "data": { /* actual payload */ },
  "error": null
}
```

**Error:**
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

### Common Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| `FORCE_LOGOUT` | Logged in elsewhere | Go to login |
| `INSUFFICIENT_BALANCE` | Not enough to withdraw | Show error |
| `WITHDRAWAL_LIMIT_EXCEEDED` | Daily limit hit | Show error |
| `COOLING_PERIOD_ACTIVE` | Recent topup locked | Retry later |
| `INVALID_SIGNATURE` | Payment failed | Retry payment |
| `OPTIMISTIC_LOCK_CONFLICT` | Concurrent update | Retry request |
| `TOKEN_EXPIRED` | JWT expired | Refresh token |

---

## Testing URLs

```bash
# Rider wallet balance
curl -X GET 'http://localhost:3000/api/rider/wallet/{riderId}' \
  -H "Authorization: Bearer {token}"

# Customer wallet balance
curl -X GET 'http://localhost:3000/api/customer/wallet/{customerId}' \
  -H "Authorization: Bearer {token}"

# Rider transactions
curl -X GET 'http://localhost:3000/api/rider/wallet/{riderId}/transactions?page=1&per_page=20' \
  -H "Authorization: Bearer {token}"

# Check eligibility
curl -X GET 'http://localhost:3000/api/rider/wallet/{riderId}/eligibility' \
  -H "Authorization: Bearer {token}"

# Withdrawal info
curl -X GET 'http://localhost:3000/api/rider/wallet/{riderId}/withdraw/info' \
  -H "Authorization: Bearer {token}"

# Initiate topup
curl -X POST 'http://localhost:3000/api/rider/wallet/{riderId}/topup/initiate' \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"amount": 20000, "gateway": "razorpay"}'

# Confirm cash
curl -X POST 'http://localhost:3000/api/rider/wallet/{riderId}/{tripId}/confirm-cash' \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"trip_id": "{tripId}", "idempotency_key": "unique_key"}'
```

---

## Status: Ready for Implementation ✅

All endpoints are built and tested. Frontend integration is straightforward:
1. Update URLs (5-10 minutes)
2. Add error handler (5 minutes)
3. Add new features (1-2 hours depending on scope)

See `FRONTEND_CHANGES_REQUIRED.md` for detailed examples.
