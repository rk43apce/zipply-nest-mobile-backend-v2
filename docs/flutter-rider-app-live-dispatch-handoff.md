# Flutter Rider App Live Dispatch Handoff

This document is for the Flutter rider app implementation. The goal is to replace the HTML rider simulator with a real Android/emulator rider app that connects to the backend like a production app.

No dummy order offers should be used in the Flutter app. Offers must come from backend WebSocket events after a customer creates an order from the customer UI/API.

## Goal

End-to-end flow:

1. Customer creates order from customer UI.
2. Backend dispatch searches nearby online riders.
3. Flutter rider app is online with real/emulator GPS.
4. Backend sends `order_offer` through WebSocket.
5. Rider sees offer screen automatically.
6. Rider accepts/rejects.
7. Rider moves delivery through pickup, transit, delivered.
8. Customer screen receives live updates.

## Environment

### Backend

Local backend normally runs on:

```text
http://localhost:3000
```

From Android Studio emulator, `localhost` means the emulator itself. Use:

```text
http://10.0.2.2:3000
```

Socket.IO URL from emulator:

```text
http://10.0.2.2:3000
path: /ws
```

For real device on same Wi-Fi, use the Mac LAN IP:

```text
http://<mac-lan-ip>:3000
```

Example:

```text
http://192.168.1.15:3000
```

## API Envelope

All successful REST responses are wrapped:

```json
{
  "success": true,
  "request_id": "uuid",
  "data": {}
}
```

Errors:

```json
{
  "success": false,
  "request_id": "uuid",
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

Flutter should parse `success`. Do not assume HTTP 200 always means business success.

## Auth

### 1. Send OTP

```http
POST /api/auth/otp/send
Content-Type: application/json
```

Request:

```json
{
  "mobile": "9876543210"
}
```

Response:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "message": "OTP sent successfully",
    "expires_in_seconds": 300,
    "dev_otp": "1234"
  }
}
```

`dev_otp` appears only in non-production. In production, OTP comes by SMS.

### 2. Verify OTP

```http
POST /api/auth/otp/verify
Content-Type: application/json
```

Request:

```json
{
  "mobile": "9876543210",
  "otp": "1234"
}
```

Response:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "access_token": "jwt-access-token",
    "refresh_token": "jwt-refresh-token",
    "expires_in": 604800,
    "rider": {
      "rider_id": "6d24da5c-465a-402a-b17b-b37459bbcbe2",
      "mobile": "9876543210",
      "name": "Rider Name",
      "onboarding_status": "activated",
      "is_new": false
    }
  }
}
```

Store:

- `access_token`
- `refresh_token`
- `rider.rider_id`
- rider profile fields

All protected APIs need:

```http
Authorization: Bearer <access_token>
```

### 3. Refresh Token

```http
POST /api/auth/token/refresh
Content-Type: application/json
```

Request:

```json
{
  "refresh_token": "jwt-refresh-token"
}
```

Response:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "access_token": "new-jwt-access-token",
    "expires_in": 604800
  }
}
```

## Rider Profile and Activation

Onboarding is already implemented in the Flutter app, but before allowing Go Online the app must verify account status.

### Get Profile

```http
GET /api/rider/profile/{rider_id}
Authorization: Bearer <access_token>
```

Response:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "rider_id": "6d24da5c-465a-402a-b17b-b37459bbcbe2",
    "mobile": "9876543210",
    "name": "Rider Name",
    "city": "Mumbai",
    "vehicle_type": "bike",
    "max_parcel_weight_kg": 10,
    "onboarding_status": "activated",
    "rating": 0,
    "total_deliveries": 0,
    "acceptance_rate": 100,
    "activated_at": "2026-07-04T08:00:00.000Z",
    "bank_account": {
      "account_masked": "XXXX1234",
      "ifsc_code": "HDFC0001234",
      "upi_id": "rider@upi",
      "verification_status": "verified"
    }
  }
}
```

### Get Onboarding Status

```http
GET /api/rider/onboarding/status/{rider_id}
Authorization: Bearer <access_token>
```

Response:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "rider_id": "6d24da5c-465a-402a-b17b-b37459bbcbe2",
    "onboarding_status": "activated",
    "steps": {
      "profile": { "completed": true },
      "documents": {
        "completed": true,
        "uploaded_count": 4,
        "verified_count": 4,
        "all_verified": true
      },
      "background_check": { "completed": true, "status": "cleared" },
      "bank": { "completed": true },
      "activation": { "completed": true }
    },
    "completed_steps": 5,
    "total_steps": 5,
    "current_step": "complete",
    "next_action": "Start delivering"
  }
}
```

Flutter rule:

- If `onboarding_status !== "activated"`, do not show Go Online as active.
- Send user back to onboarding completion flow.

## WebSocket

Use Socket.IO client, not raw WebSocket.

Recommended Flutter package:

```yaml
socket_io_client: ^3.0.0
```

Connection:

```dart
final socket = IO.io(
  'http://10.0.2.2:3000',
  IO.OptionBuilder()
    .setPath('/ws')
    .setTransports(['websocket'])
    .setAuth({'token': accessToken})
    .disableAutoConnect()
    .build(),
);

socket.connect();
```

Backend joins rider socket into:

```text
rider:{rider_id}
```

based on the JWT token.

### Socket Events Flutter Must Listen To

#### connect

Socket connected.

Use this to show live connection status.

#### disconnect

Socket disconnected.

Flutter should:

- show reconnecting/offline indicator
- keep REST fallback status refresh available
- reconnect automatically

#### order_offer

This is the important event. Show offer screen immediately.

Payload:

```json
{
  "type": "order_offer",
  "offer_id": "45d9d0b0-cc41-4f12-9e7e-710cbdf38c9e",
  "order_id": "ORD-20260704-7159",
  "pickup": {
    "lat": 19.0596,
    "lng": 72.8295,
    "address": "Current location (19.0596, 72.8295)"
  },
  "dropoff": {
    "lat": 19.0728,
    "lng": 72.8826,
    "address": "14B, Juhu Scheme, Mumbai"
  },
  "distance_km": 3.32,
  "estimated_earnings": 7300,
  "display_earnings": "₹73.00",
  "customer_fare": 7800,
  "display_customer_fare": "₹78.00",
  "platform_fee": 500,
  "display_platform_fee": "₹5.00",
  "timeout_seconds": 30,
  "expires_at": "2026-07-04T08:30:45.000Z",
  "special_notes": "Handle with care",
  "parcel_weight_kg": 2.5
}
```

UI rule:

- Top/big amount should be `display_customer_fare`.
- Label it as `Customer fare to collect`.
- Below it show `Rider earning` = `display_earnings`.
- Also show platform fee.
- For cash orders, rider may need to collect full customer fare from customer.

Important:

- `estimated_earnings`, `customer_fare`, `platform_fee` are in paise.
- Display strings are ready for UI.

#### offer_cancelled

Payload:

```json
{
  "offer_id": "45d9d0b0-cc41-4f12-9e7e-710cbdf38c9e",
  "reason": "timeout"
}
```

Possible reasons:

- `timeout`
- `assigned_to_other`
- `offline`
- `customer_cancelled`

Flutter rule:

- If current visible offer has same `offer_id`, remove offer screen.
- Show small message: offer expired/cancelled.

#### order_assigned_confirmed

Sent to rider after accept succeeds.

Payload:

```json
{
  "assigned": true,
  "order_id": "ORD-20260704-7159",
  "offer_id": "45d9d0b0-cc41-4f12-9e7e-710cbdf38c9e",
  "dispatch_id": "d9604c68-dbe0-4a19-86b9-cbaf4e7aa8e1",
  "pickup": {
    "lat": 19.0596,
    "lng": 72.8295,
    "address": "Current location (19.0596, 72.8295)",
    "contact_name": "Customer",
    "contact_phone": "9876543210"
  },
  "dropoff": {
    "lat": 19.0728,
    "lng": 72.8826,
    "address": "14B, Juhu Scheme, Mumbai",
    "contact_name": "Priya Sharma",
    "contact_phone_masked": "******4567"
  },
  "distance_km": 3.32,
  "estimated_earnings": 7300,
  "special_notes": "Handle with care",
  "navigation_url": "https://maps.google.com/?q=19.0596,72.8295"
}
```

Flutter rule:

- Navigate to Active Delivery screen.
- Store `activeOrderId`.
- Start on-trip location heartbeat.

#### location_ack

Only emitted when app sends socket event `location_update`.

Payload:

```json
{
  "updated_at": "2026-07-04T08:30:00.000Z",
  "lat": 19.0596,
  "lng": 72.8295
}
```

This event is optional. Production location update should use REST `/api/dispatch/location` because backend dispatch matching uses that endpoint.

## Go Online Flow

Before going online:

1. Must be logged in.
2. Must have `onboarding_status = activated`.
3. Must have location permission.
4. Must have valid GPS coordinates.
5. Must connect WebSocket before or immediately after going online.

### API

```http
POST /api/dispatch/online
Authorization: Bearer <access_token>
Content-Type: application/json
```

Request:

```json
{
  "rider_id": "6d24da5c-465a-402a-b17b-b37459bbcbe2",
  "city": "Mumbai",
  "lat": 19.0596,
  "lng": 72.8295,
  "vehicle_type": "bike",
  "max_parcel_weight_kg": 10
}
```

Response:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "rider_id": "6d24da5c-465a-4072-999c-fd751ccbb9ee",
    "status": "available",
    "city": "Mumbai",
    "online_since": "2026-07-04T08:25:00.000Z"
  }
}
```

Possible errors:

```json
{
  "success": false,
  "error": {
    "code": "RIDER_NOT_ACTIVATED",
    "message": "Rider is not activated"
  }
}
```

```json
{
  "success": false,
  "error": {
    "code": "INVALID_COORDINATES",
    "message": "Invalid coordinates"
  }
}
```

## Go Offline

```http
POST /api/dispatch/offline
Authorization: Bearer <access_token>
Content-Type: application/json
```

Request:

```json
{
  "rider_id": "6d24da5c-465a-402a-b17b-b37459bbcbe2"
}
```

Response:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "rider_id": "6d24da5c-465a-402a-b17b-b37459bbcbe2",
    "status": "offline",
    "offline_at": "2026-07-04T09:00:00.000Z",
    "pending_offer_auto_rejected": false
  }
}
```

Flutter rule:

- Stop location heartbeat.
- Clear active pending offer.
- Keep active delivery if backend still says rider is on trip.

## Location Updates

Use real GPS. Do not send dummy coordinates.

Recommended frequency:

- Available/idle: every 20-30 seconds
- On active delivery: every 5-10 seconds
- Send immediately when rider moves more than 30 meters
- Always send when going online

Backend already throttles and skips heavy updates for tiny movements.

```http
POST /api/dispatch/location
Authorization: Bearer <access_token>
Content-Type: application/json
```

Request:

```json
{
  "rider_id": "6d24da5c-465a-402a-b17b-b37459bbcbe2",
  "city": "Mumbai",
  "lat": 19.0597,
  "lng": 72.8297,
  "speed": 18,
  "bearing": 90
}
```

Response:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "updated_at": "2026-07-04T08:31:00.000Z"
  }
}
```

If backend skips expensive GEO/telemetry update:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "updated_at": "2026-07-04T08:31:00.000Z",
    "skipped_heavy_update": true
  }
}
```

Rate limit error:

```json
{
  "success": false,
  "request_id": "req-id",
  "error": {
    "code": "RATE_LIMITED",
    "message": "Max 1 update per 3 seconds"
  }
}
```

Flutter should ignore occasional `RATE_LIMITED` for background heartbeat and retry later.

## Dispatch Status

Use this on app resume, reconnect, startup, and after refresh.

```http
GET /api/dispatch/status?rider_id={rider_id}
Authorization: Bearer <access_token>
```

Offline/available response:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "rider_id": "6d24da5c-465a-402a-b17b-b37459bbcbe2",
    "status": "available",
    "city": "Mumbai",
    "lat": 19.0596,
    "lng": 72.8295,
    "last_seen": "2026-07-04T08:30:00.000Z",
    "current_order_id": null,
    "online_since": "2026-07-04T08:25:00.000Z"
  }
}
```

On-trip response:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "rider_id": "6d24da5c-465a-402a-b17b-b37459bbcbe2",
    "status": "on_trip",
    "current_order_id": "ORD-20260704-7159",
    "active_delivery": {
      "order_id": "ORD-20260704-7159",
      "dispatch_id": "d9604c68-dbe0-4a19-86b9-cbaf4e7aa8e1",
      "delivery_status": "en_route_pickup",
      "pickup": {
        "lat": 19.0596,
        "lng": 72.8295,
        "address": "Current location",
        "contact_name": "Customer",
        "contact_phone": "9876543210"
      },
      "dropoff": {
        "lat": 19.0728,
        "lng": 72.8826,
        "address": "14B, Juhu Scheme, Mumbai",
        "contact_name": "Priya Sharma",
        "contact_phone_masked": "******4567"
      },
      "distance_km": 3.32,
      "estimated_earnings": 7300,
      "special_notes": "Handle with care",
      "assigned_at": "2026-07-04T08:32:00.000Z"
    }
  }
}
```

Flutter rule:

- If `current_order_id` exists, show Active Delivery screen.
- Do not show Go Online as simple available state.
- Continue location heartbeat.

## Offer Actions

### Accept Offer

```http
POST /api/dispatch/accept
Authorization: Bearer <access_token>
Content-Type: application/json
```

Request:

```json
{
  "offer_id": "45d9d0b0-cc41-4f12-9e7e-710cbdf38c9e",
  "rider_id": "6d24da5c-465a-402a-b17b-b37459bbcbe2"
}
```

Response:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "assigned": true,
    "order_id": "ORD-20260704-7159",
    "offer_id": "45d9d0b0-cc41-4f12-9e7e-710cbdf38c9e",
    "dispatch_id": "d9604c68-dbe0-4a19-86b9-cbaf4e7aa8e1",
    "pickup": {
      "lat": 19.0596,
      "lng": 72.8295,
      "address": "Current location",
      "contact_name": "Customer",
      "contact_phone": "9876543210"
    },
    "dropoff": {
      "lat": 19.0728,
      "lng": 72.8826,
      "address": "14B, Juhu Scheme, Mumbai",
      "contact_name": "Priya Sharma",
      "contact_phone_masked": "******4567"
    },
    "distance_km": 3.32,
    "estimated_earnings": 7300,
    "special_notes": "Handle with care",
    "navigation_url": "https://maps.google.com/?q=19.0596,72.8295"
  }
}
```

If another rider already accepted:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "assigned": false,
    "offer_id": "45d9d0b0-cc41-4f12-9e7e-710cbdf38c9e",
    "message": "Order was taken by another rider"
  }
}
```

Common errors:

- `OFFER_NOT_FOUND`
- `OFFER_ALREADY_RESPONDED`
- `OFFER_EXPIRED`
- `INVALID_OFFER_ID`
- `INVALID_RIDER_ID`

### Reject Offer

```http
POST /api/dispatch/reject
Authorization: Bearer <access_token>
Content-Type: application/json
```

Request:

```json
{
  "offer_id": "45d9d0b0-cc41-4f12-9e7e-710cbdf38c9e",
  "rider_id": "6d24da5c-465a-402a-b17b-b37459bbcbe2",
  "reason": "not_available"
}
```

Response:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "offer_id": "45d9d0b0-cc41-4f12-9e7e-710cbdf38c9e",
    "message": "Offer declined"
  }
}
```

## Delivery State APIs

After accept, call these in order.

State order:

```text
assigned
-> en_route_pickup
-> arrived_pickup
-> picked_up
-> in_transit
-> delivered
```

### En Route Pickup

```http
POST /api/dispatch/en-route-pickup
Authorization: Bearer <access_token>
```

Request:

```json
{
  "order_id": "ORD-20260704-7159",
  "rider_id": "6d24da5c-465a-402a-b17b-b37459bbcbe2"
}
```

Response:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "order_id": "ORD-20260704-7159",
    "status": "en_route_pickup",
    "message": "Rider is heading to pickup",
    "customer_message": "Your rider is heading to pick up your order!"
  }
}
```

### Arrived Pickup

```http
POST /api/dispatch/arrived-pickup
Authorization: Bearer <access_token>
```

Request:

```json
{
  "order_id": "ORD-20260704-7159",
  "rider_id": "6d24da5c-465a-402a-b17b-b37459bbcbe2"
}
```

Response:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "order_id": "ORD-20260704-7159",
    "status": "arrived_pickup",
    "arrival_recorded_at": "2026-07-04T08:40:00.000Z",
    "customer_notified": true,
    "wait_timeout_minutes": 10,
    "message": "Waiting for parcel. Customer has been notified."
  }
}
```

### Picked Up

```http
POST /api/dispatch/picked-up
Authorization: Bearer <access_token>
```

Request:

```json
{
  "order_id": "ORD-20260704-7159",
  "rider_id": "6d24da5c-465a-402a-b17b-b37459bbcbe2"
}
```

Response:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "order_id": "ORD-20260704-7159",
    "status": "picked_up",
    "picked_up_at": "2026-07-04T08:45:00.000Z",
    "customer_message": "Your order has been picked up!"
  }
}
```

### In Transit

```http
POST /api/dispatch/in-transit
Authorization: Bearer <access_token>
```

Request:

```json
{
  "order_id": "ORD-20260704-7159",
  "rider_id": "6d24da5c-465a-402a-b17b-b37459bbcbe2"
}
```

Response:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "order_id": "ORD-20260704-7159",
    "status": "in_transit",
    "customer_message": "Your order is on the way!"
  }
}
```

### Delivered

```http
POST /api/dispatch/delivered
Authorization: Bearer <access_token>
```

Request:

```json
{
  "order_id": "ORD-20260704-7159",
  "rider_id": "6d24da5c-465a-402a-b17b-b37459bbcbe2"
}
```

Response:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "order_id": "ORD-20260704-7159",
    "delivered_at": "2026-07-04T09:05:00.000Z",
    "earnings": {
      "base_fare": 4000,
      "distance_bonus": 3300,
      "surge_bonus": 0,
      "total": 7300,
      "display_total": "₹73.00"
    },
    "trip_summary": {
      "distance_km": 3.32,
      "duration_minutes": 33,
      "pickup_wait_minutes": 5
    },
    "rider_status_after": "available",
    "customer_notified": true
  }
}
```

Common state error:

```json
{
  "success": false,
  "request_id": "req-id",
  "error": {
    "code": "INVALID_STATE",
    "message": "Cannot deliver in current delivery state"
  }
}
```

Flutter rule:

- If delivery state is not correct, call `GET /api/dispatch/status` and rebuild the active delivery screen.
- Do not blindly mark local UI delivered unless API succeeds.

## Cancel Pickup

Use when pickup cannot happen.

```http
POST /api/dispatch/cancel-pickup
Authorization: Bearer <access_token>
```

Request:

```json
{
  "order_id": "ORD-20260704-7159",
  "rider_id": "6d24da5c-465a-402a-b17b-b37459bbcbe2",
  "reason_code": "customer_unreachable",
  "notes": "Customer did not answer phone"
}
```

Supported reason codes:

```text
oversized
overweight
vehicle_breakdown
safety_concern
long_wait
customer_unreachable
store_closed
item_unavailable
other
```

Redispatchable reasons:

```text
oversized
overweight
vehicle_breakdown
safety_concern
long_wait
customer_unreachable
```

Response for redispatch:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "cancelled": true,
    "redispatching": true,
    "redispatch_attempt": 1,
    "max_attempts": 3,
    "rider_compensation": 1500,
    "display_compensation": "₹15.00",
    "customer_message": "Assigning a better-suited rider..."
  }
}
```

## Earnings and Delivery History

### Summary

```http
GET /api/rider/earnings/summary?rider_id={rider_id}
Authorization: Bearer <access_token>
```

Response:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "today": {
      "total": 7300,
      "display_total": "₹73.00",
      "deliveries": 1,
      "online_hours": 0
    },
    "week": {
      "total": 7300,
      "display_total": "₹73.00",
      "deliveries": 1
    },
    "stats": {
      "rating": 0,
      "acceptance_rate": 100,
      "total_deliveries": 1
    }
  }
}
```

### Deliveries

```http
GET /api/rider/deliveries?rider_id={rider_id}&status=all&page=1&limit=20
Authorization: Bearer <access_token>
```

Status values:

```text
all
completed
cancelled
```

Response:

```json
{
  "success": true,
  "request_id": "req-id",
  "data": {
    "deliveries": [
      {
        "order_id": "ORD-20260704-7159",
        "from_address": "Current location",
        "to_address": "14B, Juhu Scheme, Mumbai",
        "distance_km": 3.32,
        "duration_minutes": 33,
        "earnings": 7300,
        "display_earnings": "₹73.00",
        "status": "completed",
        "delivered_at": "2026-07-04T09:05:00.000Z",
        "cancelled_at": null
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "total_pages": 1,
      "has_next": false
    }
  }
}
```

## Flutter App State Model

Recommended states:

```text
Unauthenticated
AuthenticatedOnboardingIncomplete
AuthenticatedOffline
GoingOnline
OnlineAvailable
OfferReceived
AcceptingOffer
OnTripAssigned
OnTripEnRoutePickup
OnTripArrivedPickup
OnTripPickedUp
OnTripInTransit
Delivering
DeliveredSummary
ErrorRecoverable
```

On app start:

1. Load token from secure storage.
2. If no token, show login.
3. Fetch profile/onboarding status.
4. Connect socket.
5. Fetch dispatch status.
6. If active delivery exists, restore Active Delivery screen.
7. If no active delivery, show offline/online home based on backend status.

## Location Permission

Flutter must request:

Android:

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
```

For testing, foreground location is enough if app remains open.

Production behavior:

- Ask foreground permission before Go Online.
- Ask background permission only when feature is ready and explained to user.
- If permission denied, do not allow Go Online.
- Show clear UI message.

## Android Emulator Testing Notes

Use emulator URL:

```text
http://10.0.2.2:3000
```

Set emulator GPS:

Android Studio:

```text
Emulator > Extended Controls > Location
```

Use Mumbai coordinates for local backend validation:

```text
Lat: 19.0596
Lng: 72.8295
```

Dropoff test:

```text
Lat: 19.0728
Lng: 72.8826
```

Backend validates India coordinates. If emulator location is outside India, dispatch online/location may return:

```json
{
  "code": "INVALID_COORDINATES",
  "message": "Invalid coordinates"
}
```

## End-to-End Test Plan

### Setup

Backend:

```bash
npm run migration:run
npm run start:dev
```

Customer UI:

```bash
npm run ui:customer
```

Open customer UI:

```text
http://localhost:4173
```

Run Flutter rider app on Android emulator.

Flutter base URL:

```text
http://10.0.2.2:3000
```

### Test 1: Rider Receives Offer

1. Login rider app.
2. Ensure onboarding is activated.
3. Set emulator GPS near pickup.
4. Tap Go Online.
5. Confirm socket is connected.
6. Create customer order from customer UI.
7. Rider app should receive `order_offer`.
8. Offer screen should show:
   - customer fare to collect
   - rider earning
   - pickup/dropoff address
   - countdown expiry

Expected:

- Offer appears without manual refresh.
- Backend log shows `/api/dispatch/online`.
- Socket event `order_offer` received.

### Test 2: Accept Offer

1. Tap Accept.
2. Call `/api/dispatch/accept`.
3. Rider app moves to Active Delivery screen.
4. Customer UI should show rider assigned.

Expected rider state:

```text
assigned
```

### Test 3: Delivery Progress

Tap in order:

1. En Route Pickup
2. Arrived Pickup
3. Picked Up
4. In Transit
5. Delivered

Expected:

- Each REST call succeeds.
- Customer timeline updates through WebSocket.
- After delivered, rider status becomes available.

### Test 4: App Restart During Active Delivery

1. Accept an order.
2. Kill Flutter app.
3. Reopen app.
4. App connects socket.
5. App calls `/api/dispatch/status`.

Expected:

- Active delivery restored.
- No duplicate accept.
- Correct delivery state shown.

### Test 5: Offer Timeout

1. Rider online.
2. Create order.
3. Do not accept.
4. Wait for `timeout_seconds`.

Expected:

- `offer_cancelled` event received.
- Offer removed from rider screen.
- Rider returns available.

## Important Production Rules

- Do not generate local fake offers.
- Do not mark local delivery state unless backend call succeeds.
- Do not use dummy coordinates.
- Do not poll order offers; offers come by WebSocket.
- Use REST `/api/dispatch/status` for recovery, startup, reconnect, and app resume.
- Keep access token in secure storage.
- Refresh token before expiry or after 401.
- Treat money values as paise in logic; use display strings for UI.
- Cash collection amount is `customer_fare`, not `estimated_earnings`.
- Rider payout is `estimated_earnings`.

## Minimal Flutter Implementation Checklist

- Auth screens connected to real OTP APIs.
- Secure token storage.
- Rider profile/onboarding status check.
- Socket.IO connection with `/ws` path and auth token.
- Listen to `order_offer`.
- Offer screen with accept/reject.
- Go Online with real GPS.
- Adaptive location heartbeat.
- Active delivery state machine.
- Delivery action APIs.
- Restore active delivery using `/dispatch/status`.
- Earnings summary and deliveries history.
- Error handling for invalid state, expired offer, rate limited location, invalid coordinates.

## Known Backend Assumptions

- City currently defaults to/tested with `Delhi`.
- Coordinate validation expects India coordinates.
- WebSocket authentication uses rider JWT.
- Backend uses Redis for live rider state and offer matching.
- Backend emits offers only when rider is online, activated, close enough, and capable of parcel weight.
