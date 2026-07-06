# 🎯 Frontend Integration Guide: Wallet System Changes

**Date:** July 6, 2026  
**Scope:** Rider App + Customer App  
**Status:** Implementation Ready

---

## 📋 Executive Summary

The backend wallet system has been refactored to support **both riders AND customers** with a generic table structure. Frontend changes are **minimal** because:
- ✅ Authentication system is unchanged (OTP/JWT)
- ✅ Same API response envelope format
- ✅ Same amount format (paisa)
- ✅ Session management now works correctly

**Main changes:**
1. **Wallet endpoints split:** `/api/rider/wallet/` vs `/api/customer/wallet/`
2. **Session management fixed:** No more unique constraint errors on re-login
3. **JWT claims verified:** Use correct `rider_id` or `customer_id` from token
4. **Customer wallet added:** New feature for customer app

---

## 🔄 Part 1: What Changed in Backend

### Database Level
| Change | Impact on Frontend |
|--------|-------------------|
| `customer_id` → `user_id` | ❌ No impact (transparent) |
| Added `user_type` column | ❌ No impact (transparent) |
| Fixed session unique constraint | ✅ **Re-login now works** (was broken) |

### API Level
| Endpoint | Old | New | Frontend Change |
|----------|-----|-----|-----------------|
| Rider wallet | `/api/wallet/{riderId}` | `/api/rider/wallet/{riderId}` | Update URL prefix |
| Customer wallet | ❌ Didn't exist | `/api/customer/wallet/{customerId}` | ✨ **NEW** |
| Session validation | ❌ Not enforced | Added middleware | Add force-logout handler |

### JWT Claims (No Change)
Rider token still has `rider_id`. Customer token still has `customer_id`.
```typescript
// Rider
{ rider_id: "uuid", mobile: "9944444444", onboarding_status: "registered" }

// Customer  
{ customer_id: "uuid", mobile: "9944444444", onboarding_status: "activated" }
```

---

## 🚀 Part 2: Rider App Changes Required

### 2.1 Update Wallet API URLs

**Before (old):**
```typescript
GET /api/wallet/{{riderId}}/balance
GET /api/wallet/{{riderId}}/transactions
GET /api/wallet/{{riderId}}/topup/initiate
```

**After (new):**
```typescript
GET /api/rider/wallet/{{riderId}}
GET /api/rider/wallet/{{riderId}}/transactions
GET /api/rider/wallet/{{riderId}}/topup/initiate
GET /api/rider/wallet/{{riderId}}/topup/confirm
GET /api/rider/wallet/{{riderId}}/withdraw/info
GET /api/rider/wallet/{{riderId}}/withdraw
GET /api/rider/wallet/{{riderId}}/withdraw/{{withdrawalId}}
GET /api/rider/wallet/{{riderId}}/eligibility
POST /api/rider/wallet/{{riderId}}/{{tripId}}/confirm-cash
```

### 2.2 Add Force-Logout Handler

**Add a global HTTP interceptor/middleware:**

```typescript
// interceptors/force_logout.interceptor.ts
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
        // Check for FORCE_LOGOUT error code
        if (error.error?.error?.code === 'FORCE_LOGOUT' || error.status === 401) {
          // Clear local storage
          localStorage.clear();
          sessionStorage.clear();
          
          // Show alert dialog
          alert('Your account is now active on another device.\nPlease login again to continue.');
          
          // Navigate to login
          this.router.navigate(['/auth/login']);
        }
        return throwError(error);
      })
    );
  }
}

// Add to module providers:
// { provide: HTTP_INTERCEPTORS, useClass: ForceLogoutInterceptor, multi: true }
```

### 2.3 Session Validation Check (Optional but Recommended)

```typescript
// service: wallet.service.ts
checkSessionValidity(): Observable<any> {
  return this.http.get('/api/auth/session/validate').pipe(
    catchError(err => {
      if (err.error?.error?.code === 'FORCE_LOGOUT') {
        // Handle logout
      }
      throw err;
    })
  );
}

// Call on app resume / tab focus
// this.walletService.checkSessionValidity().subscribe();
```

### 2.4 Update Wallet Service Methods

```typescript
// services/wallet.service.ts

// OLD: getWalletBalance(riderId: string)
// NEW: use updated endpoint
getWalletBalance(riderId: string): Observable<WalletDTO> {
  return this.http.get(`/api/rider/wallet/${riderId}`);
}

// OLD: getTransactions(riderId: string)
// NEW: endpoint structure same, URL updated
getTransactions(riderId: string, page: number = 1, perPage: number = 20): Observable<TransactionList> {
  return this.http.get(`/api/rider/wallet/${riderId}/transactions`, {
    params: { page: page.toString(), per_page: perPage.toString() }
  });
}

// NEW METHODS (add these)
checkEligibility(riderId: string): Observable<EligibilityDTO> {
  return this.http.get(`/api/rider/wallet/${riderId}/eligibility`);
}

getWithdrawalInfo(riderId: string): Observable<WithdrawalInfoDTO> {
  return this.http.get(`/api/rider/wallet/${riderId}/withdraw/info`);
}

initiateWithdrawal(riderId: string, body: WithdrawalInitiateDTO): Observable<WithdrawalDTO> {
  return this.http.post(`/api/rider/wallet/${riderId}/withdraw`, body);
}

confirmCashCollection(riderId: string, tripId: string, body: CashConfirmDTO): Observable<CashConfirmResultDTO> {
  return this.http.post(`/api/rider/wallet/${riderId}/${tripId}/confirm-cash`, body);
}
```

---

## 👥 Part 3: Customer App Changes Required

### 3.1 New Wallet Endpoints (Customers)

```typescript
// NEW endpoints for customer wallet
GET /api/customer/wallet/{{customerId}}
GET /api/customer/wallet/{{customerId}}/transactions

// Response format is identical to rider wallet
{
  "success": true,
  "data": {
    "wallet_id": "uuid",
    "customer_id": "uuid",
    "cached_balance": 5000,
    "available_balance": 5000,
    "display_balance": "₹50.00",
    "currency": "INR",
    "status": "active"
  }
}
```

### 3.2 Add Customer Wallet Service

```typescript
// services/customer-wallet.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class CustomerWalletService {
  constructor(private http: HttpClient) {}

  getBalance(customerId: string): Observable<WalletDTO> {
    return this.http.get(`/api/customer/wallet/${customerId}`);
  }

  getTransactions(customerId: string, page: number = 1, perPage: number = 20): Observable<TransactionList> {
    return this.http.get(`/api/customer/wallet/${customerId}/transactions`, {
      params: { page: page.toString(), per_page: perPage.toString() }
    });
  }
}
```

### 3.3 Update Authentication Flow

The customer login flow already returns JWT with `customer_id`. No changes needed. Just ensure:

```typescript
// Extract customer ID from JWT
const token = localStorage.getItem('access_token');
const decoded = jwt_decode(token);
const customerId = decoded.customer_id; // Use this for API calls
```

---

## 📊 Part 4: API Response Payload Changes

### 4.1 Wallet Balance Response (No Format Change, URL Only)

**Rider:**
```json
{
  "success": true,
  "data": {
    "wallet_id": "uuid",
    "rider_id": "uuid",
    "cached_balance": 35000,
    "available_balance": 35000,
    "display_balance": "₹350.00",
    "currency": "INR",
    "status": "active",
    "is_blocked": false
  }
}
```

**Customer:**
```json
{
  "success": true,
  "data": {
    "wallet_id": "uuid",
    "customer_id": "uuid",
    "cached_balance": 0,
    "available_balance": 0,
    "display_balance": "₹0.00",
    "currency": "INR",
    "status": "active"
  }
}
```

✅ **Frontend action:** Just parse the same structure. Field name changes from `rider_id` to `customer_id`, but your code should already extract it dynamically.

### 4.2 New Response Field: `previous_device_logged_out`

**Login response now includes:**
```json
{
  "success": true,
  "data": {
    "access_token": "...",
    "refresh_token": "...",
    "rider": { ... },
    "previous_device_logged_out": true,  // ← NEW
    "previous_device": "Samsung Galaxy A52"  // ← NEW
  }
}
```

**Frontend action:** After login, check this field:
```typescript
if (response.data.previous_device_logged_out) {
  showInfoDialog(
    'Device Change Detected',
    `You were logged out from: ${response.data.previous_device}`
  );
}
```

---

## 🔐 Part 5: Security & Session Management

### 5.1 Before: Session Bug (What Was Wrong)

```
Scenario: Rider logs in on Device A → OTP verified → Session created
         Then logs in again on Device B → ERROR "Unique constraint violation"
         
Reason: Backend tried to INSERT new session but (rider_id, user_type) 
        unique key already existed from Device A session
        
Result: Second login failed completely ❌
```

### 5.2 After: Session Fix (What's Fixed)

```
Scenario: Same as above
         Then logs in again on Device B → Session UPDATED in place ✅
         
Result: Second login succeeds, old device session invalidated
```

**Frontend impact:** Re-login now works correctly. No code changes needed.

### 5.3 Force Logout Handling (What's New)

```typescript
// Add to your app initialization / splash screen

// On every important API call, listen for FORCE_LOGOUT
httpClient.interceptors.response.addListener(error => {
  if (error.code === 'FORCE_LOGOUT' || error.statusCode === 401) {
    // Device was logged out
    localStorage.clear();
    showDialog('Logged out from another device');
    navigateToLogin();
  }
});

// Optional: Periodic session check (every 5 minutes)
setInterval(() => {
  walletService.checkSessionValidity().catch(err => {
    if (err.code === 'FORCE_LOGOUT') {
      handleForceLogout();
    }
  });
}, 300000);
```

---

## 📝 Part 6: Checklist for Frontend Implementation

### Rider App
- [ ] Update all `/api/wallet/` URLs to `/api/rider/wallet/`
- [ ] Add HTTP interceptor for `FORCE_LOGOUT` error handling
- [ ] Add global session validation on app resume
- [ ] Test re-login on same device (should now work)
- [ ] Test login from another device (should invalidate first session)
- [ ] Display `previous_device_logged_out` notification if present
- [ ] Test all wallet endpoints with new URLs
- [ ] Test eligibility gate before showing ride requests
- [ ] Test withdrawal flow (new endpoint structure)
- [ ] Test cash collection confirmation (URL updated)

### Customer App
- [ ] Add `CustomerWalletService` with `/api/customer/wallet/` endpoints
- [ ] Add customer wallet balance screen
- [ ] Add customer transaction history screen
- [ ] Add HTTP interceptor for `FORCE_LOGOUT` (same as rider app)
- [ ] Extract `customer_id` from JWT correctly
- [ ] Test all wallet endpoints
- [ ] Test login/re-login flow

### Common (Both Apps)
- [ ] Verify JWT token extraction still works
- [ ] Test with existing auth flow (no changes to OTP/JWT generation)
- [ ] Test all error codes in Part 8 below
- [ ] Verify amount formatting (divide by 100 for display)
- [ ] Test idempotency key handling for mutation requests
- [ ] Add local caching for wallet balance (offline mode)

---

## 🚨 Part 7: Error Codes & Handling

### New/Updated Error Codes

| Code | HTTP | Scenario | Frontend Action |
|------|------|----------|-----------------|
| `FORCE_LOGOUT` | 401 | Logged in on another device | Clear storage → Show dialog → Navigate to login |
| `TOKEN_EXPIRED` | 401 | JWT token expired | Auto-refresh using refresh_token |
| `WALLET_FROZEN` | 403 | Admin froze wallet | Show error: "Wallet blocked by admin" |
| `INSUFFICIENT_BALANCE` | 422 | Withdrawal > available | Show error: "Cannot withdraw more than ₹X available" |
| `WITHDRAWAL_LIMIT_EXCEEDED` | 422 | Daily limit exceeded | Show error: "Daily limit exceeded, ₹Y remaining today" |
| `COOLING_PERIOD_ACTIVE` | 422 | Recent topup locked | Show error: "Wait 30 min before withdrawing recent topup" |
| `INVALID_SIGNATURE` | 400 | Payment signature failed | Show error: "Payment verification failed, try again" |
| `DUPLICATE_REQUEST` | 409 | Same idempotency key sent twice | Show error: "Request already processed" |
| `OPTIMISTIC_LOCK_CONFLICT` | 409 | Concurrent update | Show error: "Please try again" (auto-retry) |

### Handling Examples

```typescript
// Global error handler
handleApiError(error: HttpErrorResponse) {
  const code = error.error?.error?.code;
  
  switch (code) {
    case 'FORCE_LOGOUT':
      this.handleForceLogout();
      break;
    case 'TOKEN_EXPIRED':
      this.authService.refreshToken();
      break;
    case 'INSUFFICIENT_BALANCE':
      this.showError('Insufficient balance for this transaction');
      break;
    case 'COOLING_PERIOD_ACTIVE':
      this.showError('Please wait before withdrawing recent funds');
      break;
    case 'OPTIMISTIC_LOCK_CONFLICT':
      this.retryWithExponentialBackoff();
      break;
    default:
      this.showError(error.error?.error?.message || 'Something went wrong');
  }
}
```

---

## 💡 Part 8: Implementation Examples

### Example 1: Get Rider Wallet Balance

**Before (old code):**
```typescript
this.http.get('/api/wallet/5002/balance')
```

**After (new code):**
```typescript
const riderId = this.user.rider_id; // From JWT
this.http.get(`/api/rider/wallet/${riderId}`)
```

**Response handling:**
```typescript
this.walletService.getBalance(riderId).subscribe(
  response => {
    const wallet = response.data;
    if (wallet.is_blocked) {
      this.showBlockedBanner(
        `Wallet blocked. Balance: ${wallet.display_balance}. ` +
        `Top up ₹${wallet.action_required?.display_minimum} to continue.`
      );
    } else {
      this.displayBalance(wallet.display_balance);
    }
  },
  error => this.handleApiError(error)
);
```

### Example 2: Get Customer Wallet (New for Customer App)

```typescript
// In customer-wallet.component.ts
export class CustomerWalletComponent implements OnInit {
  customerId: string;
  wallet: WalletDTO;

  constructor(
    private walletService: CustomerWalletService,
    private auth: AuthService
  ) {
    // Extract customer_id from JWT
    const token = this.auth.getToken();
    this.customerId = jwt_decode(token).customer_id;
  }

  ngOnInit() {
    this.loadWallet();
  }

  loadWallet() {
    this.walletService.getBalance(this.customerId).subscribe(
      response => {
        this.wallet = response.data;
      },
      error => this.handleError(error)
    );
  }

  loadTransactions() {
    this.walletService.getTransactions(this.customerId, 1, 20).subscribe(
      response => {
        this.transactions = response.data.transactions;
      }
    );
  }
}
```

### Example 3: Handle Re-Login (Now Works)

```typescript
// Before: This would fail with unique constraint error
// Now: It works correctly

async handleReLogin() {
  // Send OTP
  const otpResponse = await this.authService.sendOtp('9944444444');
  
  // User verifies OTP
  const verifyResponse = await this.authService.verifyOtp(
    '9944444444', 
    userEnteredOtp
  );
  
  // Check if logged out from another device
  if (verifyResponse.data.previous_device_logged_out) {
    this.showNotification(
      'You were logged out from: ' + 
      verifyResponse.data.previous_device
    );
  }
  
  // Save token and proceed
  localStorage.setItem('access_token', verifyResponse.data.access_token);
  this.navigateToHome();
}
```

### Example 4: Topup Flow with Razorpay

```typescript
async initiateTopup(amount: number) {
  try {
    // Step 1: Get payment order from backend
    const initResponse = await this.walletService
      .initiateTopup(this.riderId, amount)
      .toPromise();
    
    const orderData = initResponse.data;

    // Step 2: Open Razorpay checkout
    const razorpayOptions = {
      key: orderData.key_id,
      order_id: orderData.gateway_order_id,
      amount: orderData.amount,
      currency: 'INR',
      name: 'Vida Rider',
      prefill: orderData.prefill,
      theme: { color: '#3399cc' },
      handler: (paymentResponse: any) => {
        this.confirmTopup(
          orderData.payment_txn_id,
          paymentResponse.razorpay_payment_id,
          paymentResponse.razorpay_signature
        );
      }
    };

    // @ts-ignore
    const razorpay = new Razorpay(razorpayOptions);
    razorpay.open();
  } catch (error) {
    this.handleError(error);
  }
}

async confirmTopup(txnId: number, paymentId: string, signature: string) {
  try {
    const confirmResponse = await this.walletService
      .confirmTopup(this.riderId, {
        payment_txn_id: txnId,
        gateway_payment_id: paymentId,
        gateway_signature: signature
      })
      .toPromise();

    this.showSuccess(
      `Topup successful!\nNew balance: ${confirmResponse.data.display_new_balance}`
    );
    
    // Refresh wallet display
    this.loadWallet();
  } catch (error) {
    this.handleError(error);
  }
}
```

### Example 5: Check Ride Eligibility

```typescript
// Call before showing incoming ride to rider
async checkIfRiderCanAcceptRide() {
  try {
    const eligibility = await this.walletService
      .checkEligibility(this.riderId)
      .toPromise();

    if (!eligibility.data.can_accept_rides) {
      // Show topup screen instead of ride request
      this.showTopupRequiredScreen({
        minimumAmount: eligibility.data.display_minimum,
        currentBalance: eligibility.data.wallet_balance
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error('Eligibility check failed:', error);
    // Default: allow (fail open)
    return true;
  }
}

// In ride notification handler
onNewRideReceived(ride: RideOffer) {
  this.checkIfRiderCanAcceptRide().then(canAccept => {
    if (canAccept) {
      this.showRideOfferDialog(ride);
    }
  });
}
```

### Example 6: Withdrawal Flow

```typescript
async initiateWithdrawal() {
  try {
    // Step 1: Get available balance and limits
    const info = await this.walletService
      .getWithdrawalInfo(this.riderId)
      .toPromise();

    if (info.data.available_for_withdrawal === 0) {
      this.showError('No balance to withdraw');
      return;
    }

    // Step 2: Show withdrawal form (pre-filled with available amount)
    const withdrawAmount = await this.showWithdrawalForm({
      maxAmount: info.data.available_for_withdrawal,
      display_max: info.data.display_available,
      minAmount: info.data.min_withdrawal,
      payoutMethods: info.data.payout_methods
    });

    // Step 3: Confirm withdrawal
    const idempotencyKey = `withdraw_${this.riderId}_${Date.now()}_${Math.random()}`;
    
    const response = await this.walletService
      .initiateWithdrawal(this.riderId, {
        amount: withdrawAmount,
        payout_method: selectedMethod,
        idempotency_key: idempotencyKey
      })
      .toPromise();

    this.showSuccess(
      `Withdrawal initiated!\nAmount: ${response.data.display_amount}\n` +
      `Status: ${response.data.status}\n` +
      `Est. arrival: ${response.data.estimated_arrival}`
    );

  } catch (error) {
    if (error.error?.error?.code === 'COOLING_PERIOD_ACTIVE') {
      this.showError(
        'Recent topup is locked for 30 minutes.\n' +
        'Please try again later.'
      );
    } else {
      this.handleError(error);
    }
  }
}
```

### Example 7: Cash Collection & Commission

```typescript
async confirmCashCollection(trip: Trip) {
  try {
    const idempotencyKey = `cash_confirm_${trip.id}_${Date.now()}`;

    const response = await this.walletService
      .confirmCashCollection(this.riderId, trip.id, {
        trip_id: trip.id,
        idempotency_key: idempotencyKey
      })
      .toPromise();

    const result = response.data;

    // Show detailed breakdown
    this.showConfirmationDialog({
      title: 'Cash Collected',
      items: [
        { label: 'Cash collected', value: result.display_collected },
        { label: 'Commission rate', value: result.commission_rate_percent },
        { label: 'Commission charged', value: result.display_commission, red: true },
        { label: 'New balance', value: result.display_new_balance, red: result.is_blocked }
      ],
      message: result.commission_note
    });

    // If blocked after commission, show topup nudge
    if (result.is_blocked) {
      this.showTopupNudge(
        `Your wallet is now ${result.display_new_balance}. ` +
        `Top up to accept more rides.`
      );
    }

    // Refresh wallet
    this.loadWallet();

  } catch (error) {
    this.handleError(error);
  }
}
```

---

## 🔗 Part 9: TypeScript Type Definitions

Add these to your models:

```typescript
// models/wallet.model.ts

export interface WalletDTO {
  wallet_id: string;
  rider_id?: string; // Rider wallet
  customer_id?: string; // Customer wallet
  cached_balance: number;
  available_balance: number;
  display_balance: string;
  display_available?: string;
  currency: string;
  status: 'active' | 'frozen';
  is_blocked?: boolean;
  blocked_reason?: string;
  negative_threshold?: number;
  display_threshold?: string;
}

export interface TransactionDTO {
  txn_id: string;
  txn_type: 'credit' | 'debit';
  category: string;
  amount: number;
  display_amount: string;
  running_balance: number;
  description: string;
  reference_type: string;
  reference_id: string;
  status: 'completed' | 'pending' | 'failed';
  created_at: string;
}

export interface TransactionList {
  transactions: TransactionDTO[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

export interface TopupInitiateDTO {
  amount: number;
  gateway: 'razorpay';
}

export interface TopupInitiateResponseDTO {
  payment_txn_id: number;
  gateway_order_id: string;
  amount: number;
  currency: string;
  gateway: string;
  key_id: string;
  prefill: {
    name: string;
    contact: string;
  };
}

export interface TopupConfirmDTO {
  payment_txn_id: number;
  gateway_payment_id: string;
  gateway_signature: string;
}

export interface EligibilityDTO {
  can_accept_rides: boolean;
  wallet_balance: number;
  is_blocked: boolean;
  blocked_reason?: string;
  action_required?: string;
  minimum_topup_needed?: number;
  display_minimum?: string;
}

export interface WithdrawalInitiateDTO {
  amount: number;
  payout_method: string;
  idempotency_key: string;
}

export interface WithdrawalDTO {
  withdrawal_id: number;
  amount: number;
  payout_method: string;
  payout_to: string;
  status: 'processing' | 'completed' | 'failed';
  new_balance: number;
  display_new_balance: string;
  estimated_arrival: string;
}

export interface CashConfirmDTO {
  trip_id: string;
  idempotency_key: string;
}

export interface CashConfirmResultDTO {
  trip_id: string;
  cash_collected: number;
  display_collected: string;
  commission_amount: number;
  commission_rate_percent: string;
  display_commission: string;
  commission_note: string;
  new_wallet_balance: number;
  display_new_balance: string;
  is_blocked: boolean;
  blocked_message?: string;
  status: string;
}

export interface PushNotificationPayload {
  type: string;
  title: string;
  body: string;
  action: string;
  data?: any;
}
```

---

## 🎓 Part 10: Testing Checklist

### Unit Tests
- [ ] WalletService.getBalance() with mock HTTP
- [ ] WalletService.checkEligibility() returns correct is_blocked flag
- [ ] AmountFormatter.display() converts paisa to rupees correctly
- [ ] ForceLogoutInterceptor catches 401 with FORCE_LOGOUT code
- [ ] SessionValidator rejects invalid tokens

### Integration Tests
- [ ] Login → Wallet balance → Transactions flow
- [ ] Topup initiate → Razorpay → Confirm flow
- [ ] Withdrawal info → initiate → status check flow
- [ ] Cash confirm → Commission deduction → Balance update
- [ ] Re-login on same device works (was broken, now fixed)

### E2E Tests  
- [ ] Rider: Full wallet balance check
- [ ] Rider: Topup flow with Razorpay
- [ ] Rider: Withdrawal flow
- [ ] Rider: Cash collection & commission
- [ ] Rider: Eligibility gate before ride acceptance
- [ ] Customer: Wallet balance & transactions
- [ ] Customer: Re-login (same device)
- [ ] Customer: Login from another device → Force logout

### Manual Testing
- [ ] Test all error codes from Part 7
- [ ] Test with negative balance (display in red)
- [ ] Test with zero balance
- [ ] Test with very large balance (formatting)
- [ ] Test offline mode (use cached balance)
- [ ] Test network retry on connection loss
- [ ] Test idempotency (send same request twice)

---

## 📞 Part 11: Support & Troubleshooting

### Q: Getting "401 Unauthorized" on wallet endpoints?
**A:** Check:
- [ ] JWT token is valid (not expired)
- [ ] Token is in Authorization header as "Bearer {token}"
- [ ] Rider ID from URL matches rider_id in JWT token
- [ ] Session is active (not logged in on another device)

### Q: Getting "UNIQUE_CONSTRAINT" error on login?
**A:** This is now fixed in backend. If still occurring:
- Ensure you're on latest build (`npm run build` on backend)
- Check database migration was applied
- Clear browser cache/local storage and retry login

### Q: Wallet balance not updating after topup?
**A:** Check:
- [ ] Razorpay signature verification passed
- [ ] confirmTopup() was called with correct signature
- [ ] Response indicates "success": true
- [ ] Refresh wallet balance after confirm

### Q: "FORCE_LOGOUT" appearing on every request?
**A:** Check:
- [ ] Token is same across requests (not regenerating)
- [ ] Device ID is consistent
- [ ] No other sessions logged in (check backend logs)
- [ ] Restart app and login fresh

---

## 📦 Summary Table

| Aspect | Before | After | Frontend Impact |
|--------|--------|-------|-----------------|
| URLs | `/api/wallet/` | `/api/rider/wallet/` | Update URLs |
| Customer wallet | ❌ None | ✅ `/api/customer/wallet/` | Add feature |
| Re-login | ❌ Failed (error) | ✅ Works | Automatic fix |
| Force logout | ❌ Not enforced | ✅ Enforced | Add handler |
| Error codes | ~5 codes | ~15 codes | Comprehensive error handling |
| JWT structure | `rider_id` | `rider_id` (same) | No change |
| Amount format | paisa | paisa (same) | No change |

---

**Last Updated:** July 6, 2026  
**Backend Version:** 1.0.0  
**Status:** Ready for Frontend Implementation
