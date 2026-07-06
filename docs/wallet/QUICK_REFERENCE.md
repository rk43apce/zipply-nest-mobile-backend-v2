# 🚀 Quick Reference: Frontend API Changes

## URL Changes

```diff
- GET /api/wallet/{riderId}
+ GET /api/rider/wallet/{riderId}

- GET /api/wallet/{riderId}/transactions
+ GET /api/rider/wallet/{riderId}/transactions

+ GET /api/customer/wallet/{customerId}        # NEW
+ GET /api/customer/wallet/{customerId}/transactions  # NEW
```

## New Endpoints (Riders)

```
GET    /api/rider/wallet/{riderId}/eligibility
GET    /api/rider/wallet/{riderId}/withdraw/info
POST   /api/rider/wallet/{riderId}/withdraw
GET    /api/rider/wallet/{riderId}/withdraw/{withdrawalId}
POST   /api/rider/wallet/{riderId}/topup/initiate
POST   /api/rider/wallet/{riderId}/topup/confirm
POST   /api/rider/wallet/{riderId}/{tripId}/confirm-cash
```

## JWT Claims (No Change)

**Rider:** `{ rider_id, mobile, onboarding_status }`  
**Customer:** `{ customer_id, mobile, onboarding_status }`

## Response Format (No Change)

```json
{
  "success": true/false,
  "data": { /* payload */ },
  "error": { "code": "...", "message": "..." }
}
```

## Key Field Names

| Before | After | Impact |
|--------|-------|--------|
| `wallet_id` | `wallet_id` | ✅ Same |
| Response has `rider_id` | Response still has `rider_id` | ✅ Same |
| Response has `display_balance` | Response still has `display_balance` | ✅ Same |
| N/A | Customer response has `customer_id` | ✨ New |

## HTTP Interceptor Required

Add handler for error code `FORCE_LOGOUT`:
```typescript
if (error.error?.error?.code === 'FORCE_LOGOUT') {
  // Clear storage → Show dialog → Navigate to login
}
```

## Session Management (Fixed)

**Before:** Re-login failed with unique constraint error ❌  
**After:** Re-login works correctly ✅  
**Frontend action:** None required (transparent fix)

## Login Response Update

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "rider": { ... },
  "previous_device_logged_out": true,      // ← NEW FIELD
  "previous_device": "Samsung Galaxy A52"  // ← NEW FIELD
}
```

**Frontend action:**
```typescript
if (response.data.previous_device_logged_out) {
  showNotification(`Logged out from: ${response.data.previous_device}`);
}
```

## Error Codes (New)

```
FORCE_LOGOUT               → 401  Clear storage, go to login
WALLET_FROZEN              → 403  Wallet is frozen
INSUFFICIENT_BALANCE       → 422  Not enough to withdraw
WITHDRAWAL_LIMIT_EXCEEDED  → 422  Daily limit hit
COOLING_PERIOD_ACTIVE      → 422  Must wait after topup
INVALID_SIGNATURE          → 400  Payment verification failed
OPTIMISTIC_LOCK_CONFLICT   → 409  Retry the request
```

## Amount Handling (No Change)

- All amounts from API are in **paisa**
- Display: `₹{amount/100}`
- Example: 5000 paisa = ₹50.00

## Wallet Fields (No Change)

```typescript
interface Wallet {
  wallet_id: string;
  rider_id?: string;        // Rider wallet
  customer_id?: string;     // Customer wallet
  cached_balance: number;   // In paisa
  available_balance: number;
  display_balance: string;  // Already formatted
  currency: string;         // "INR"
  status: string;           // "active" | "frozen"
  is_blocked?: boolean;     // Negative balance flag
}
```

## Top 5 Frontend Tasks

1. **Update wallet service URLs** from `/api/wallet/` → `/api/rider/wallet/`
2. **Add HTTP interceptor** for `FORCE_LOGOUT` handling
3. **Add customer wallet service** with `/api/customer/wallet/` endpoints
4. **Test re-login** (was broken, now fixed)
5. **Add session validation** on app resume (optional but recommended)

## Rider App Changes

```typescript
// Update this
this.http.get('/api/wallet/5002/balance')

// To this
this.http.get('/api/rider/wallet/5002')
```

## Customer App Changes

```typescript
// Add this NEW service
this.http.get('/api/customer/wallet/customerId')
```

## No Changes Needed

✅ JWT token generation flow  
✅ OTP send/verify endpoints  
✅ Token refresh logic  
✅ Amount formatting (paisa → rupees)  
✅ Response envelope structure  
✅ Authentication header format  

## Testing

```bash
# Test rider wallet
curl -X GET 'http://localhost:3000/api/rider/wallet/90c2eb74-5288-403e-894f-8b55d68c7aa5' \
  -H "Authorization: Bearer <token>"

# Test customer wallet
curl -X GET 'http://localhost:3000/api/customer/wallet/660e8400-e29b-41d4-a716-446655440001' \
  -H "Authorization: Bearer <token>"
```

## FAQ

**Q: Do I need to change JWT generation?**  
A: No. Token structure is unchanged.

**Q: Do I need to update amount formatting?**  
A: No. Still paisa, same as before.

**Q: What about authentication middleware?**  
A: Already built. Only add FORCE_LOGOUT handler.

**Q: Will re-login work now?**  
A: Yes. Was broken, now fixed.

**Q: Do I need to do anything with customer_id vs rider_id?**  
A: Use the one from the JWT. Rider → rider_id, Customer → customer_id.

---

**For detailed guide, see:** `FRONTEND_CHANGES_REQUIRED.md`
