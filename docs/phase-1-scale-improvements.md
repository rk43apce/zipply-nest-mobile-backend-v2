# Phase 1 Scale Improvements

This document explains the Phase 1 changes made for supporting higher concurrent customer/rider traffic with better live experience and lower operating cost.

Target scenario: roughly 10,000 concurrent users/riders, with live dispatch, tracking, and rider location updates.

The cost numbers below are rough directional estimates. Actual savings depend on cloud provider, DB size, Redis plan, active order ratio, location frequency, and app usage pattern.

## Summary

| Area | Before | After | Expected Impact |
| --- | --- | --- | --- |
| WebSocket scaling | Events worked best on one backend instance only | Socket.IO Redis adapter shares socket events across instances | Supports horizontal scaling without losing customer/rider live updates |
| Customer tracking | Active orders polled REST every 10 seconds | WebSocket-first, REST fallback every 60 seconds only when socket disconnects | 80-95% fewer tracking REST calls during normal connected sessions |
| Rider GPS updates | Fixed heartbeat behavior, every online rider could send frequent updates | Adaptive heartbeat and movement threshold | 50-80% fewer location writes/events depending on rider movement |
| DB indexes | Some useful indexes existed, but dispatch/order hot queries needed more | Added indexes for orders, dispatches, offers, earnings, wallet transactions | Lower DB CPU and faster response under load |
| Order retries | Duplicate taps/network retries could create duplicate orders | Order create supports idempotency key | Prevents duplicate orders and wallet holds |
| Dispatch retries | Repeat accept/delivered calls could create conflicts or duplicate side effects | Accept/delivered are safer on retry | Better mobile reliability in weak networks |

## 1. WebSocket Horizontal Scaling

### Before

Socket events were emitted from the same backend instance that handled the business action. This is fine for local testing and one server.

Problem in production:

- Customer may be connected to backend instance A.
- Rider action may hit backend instance B.
- Instance B emits a socket event, but customer socket lives on A.
- Customer may miss live update unless polling catches it.

### After

Added Socket.IO Redis adapter.

Files:

- `src/realtime/redis-io.adapter.ts`
- `src/main.ts`
- `package.json`

Now all backend instances publish socket messages through Redis pub/sub. Any instance can emit to any connected customer or rider room.

### Production Benefit

- Enables multiple backend instances behind a load balancer.
- Customer timeline and rider offers stay live across instances.
- Reduces need for aggressive REST polling.

### Rough Cost Impact

This does not directly reduce cost by itself, but it enables cheaper horizontal scaling:

- Instead of one large server, run multiple smaller app instances.
- Avoid overprovisioning one big machine for peak socket load.
- Expected infra efficiency improvement: around 10-25% once traffic grows enough to require scaling.

## 2. Customer Tracking: WebSocket First

### Before

Customer tracking screen refreshed via REST every 10 seconds while the order was active.

At scale:

- 5,000 active tracking screens
- 1 REST call every 10 seconds
- About 500 requests/second only for tracking refresh

That is expensive and unnecessary when WebSocket already sends status changes.

### After

Customer screen listens to WebSocket updates:

- `rider_assigned`
- `dispatch_update`
- `rider_offer_sent`

REST refresh is now fallback only:

- every 60 seconds
- only when socket is disconnected

### Production Benefit

- Faster UX because socket events update immediately.
- Much lower API traffic.
- DB reads reduce because `/orders/:id` is not constantly hit.

### Rough Cost Impact

If 5,000 customers are tracking live orders:

Before:

- 5,000 users / 10 sec = about 500 REST requests/sec

After normal connected socket state:

- near zero periodic tracking REST requests
- only event-driven updates

If 5% sockets are disconnected:

- 250 users / 60 sec = about 4 REST requests/sec

Possible reduction:

- 90-99% fewer tracking REST calls
- DB read load for active tracking can drop 70-95%
- Backend CPU/API cost for tracking can drop 50-90%

## 3. Rider Location Throttling

### Before

Rider app sent location on a fixed heartbeat. Backend accepted frequent updates and performed Redis GEO update plus telemetry queue write.

Problem:

- Many riders sitting still still generate location writes.
- Redis GEO and telemetry load increases even without meaningful movement.
- Battery and mobile data usage are worse.

### After

Rider UI now uses adaptive heartbeat:

- Available rider: about every 25 seconds
- On-trip rider: about every 7 seconds
- Skip if rider moved less than 30 meters, with max stale guard

Backend also protects itself:

- Still updates `last_seen`
- Skips heavy Redis GEO + telemetry when movement is tiny and recent

### Production Benefit

- Rider stays visible online without writing every small GPS jitter.
- On-trip experience remains live enough for customer tracking.
- Redis/BullMQ load drops.
- Mobile battery and data usage improve.

### Rough Cost Impact

Example with 5,000 online riders:

Before, fixed 7-10 sec updates:

- about 500-700 location requests/sec

After:

- 3,000 idle/available riders at 25 sec = 120 requests/sec
- 2,000 active-trip riders at 7 sec = 285 requests/sec
- movement skip can reduce heavy updates by another 30-60%

Expected reduction:

- API location request volume: 30-60%
- heavy Redis GEO/telemetry writes: 50-80%
- mobile battery/data usage: meaningful improvement, especially for idle riders

## 4. Database Indexes

### Before

Some indexes existed, but several hot production query paths could become slow:

- customer order list
- active dispatch search
- rider active deliveries
- pending offers
- rider earnings
- wallet transaction history

### After

Added migration:

- `migrations/1720100000000-PhaseOneScaleIndexes.ts`

Indexes added for:

- orders by customer and created time
- orders by status and created time
- dispatch by order id
- dispatch by status/city/start time
- dispatch by rider/status/start time
- offers by rider/status/expiry
- offers by order/status
- earnings by rider/earned time
- wallet transactions by wallet/created time

### Production Benefit

- Faster order history.
- Faster rider delivery list.
- Faster offer expiry/lookup.
- Lower DB CPU under concurrency.

### Rough Cost Impact

Indexes usually save cost by reducing CPU and query time, but they slightly increase storage and write overhead.

Expected:

- Query latency improvement: 30-90% on indexed hot paths, depending on row count.
- DB CPU reduction: 20-60% for those query types.
- Storage increase: small, usually a few percent to low double digits depending on table size.

## 5. Idempotency for Order Create

### Before

If customer tapped place order twice, or mobile network retried the request, backend could create duplicate orders or duplicate wallet holds.

### After

Customer UI sends `idempotency_key`.

Backend stores it on the order:

- same key returns the existing order
- prevents duplicate order creation from retry

### Production Benefit

- Safer mobile experience.
- Fewer support issues.
- Prevents duplicate wallet holds/payment confusion.

### Rough Cost Impact

This is more about correctness than infra cost.

Possible operational savings:

- fewer duplicate-order refunds
- fewer customer support tickets
- fewer manual DB fixes

## 6. Idempotency for Dispatch Accept/Delivered

### Before

Repeated rider actions could produce conflicts or duplicate side effects in some retry cases.

### After

Accept:

- repeat accept by same rider returns assignment payload
- other riders still lose correctly

Delivered:

- repeat delivered call returns delivered response instead of duplicating side effects

### Production Benefit

- Better weak-network behavior for riders.
- Fewer false errors on mobile.
- Lower risk of duplicate earnings or inconsistent state.

## Approximate Overall Savings

For a production setup with thousands of concurrent users:

| Cost Area | Rough Expected Reduction |
| --- | --- |
| Customer tracking REST/API calls | 90-99% |
| Active tracking DB reads | 70-95% |
| Rider location heavy writes/events | 50-80% |
| Location API request volume | 30-60% |
| DB CPU on hot indexed queries | 20-60% |
| Duplicate order/payment support issues | High reduction, hard to quantify |

Overall backend cost reduction can be around 25-50% compared to a polling-heavy, non-throttled design at the same traffic level.

The biggest saving comes from avoiding constant customer polling and reducing unnecessary rider location writes.

## What Still Needs Phase 2

Phase 1 makes the system much healthier, but for true production at 10k+ concurrency we should still add:

- Redis cached active order tracking snapshot
- BullMQ-based offer timeout and redispatch instead of in-process intervals
- payment gateway signature verification
- structured metrics for socket count, offer latency, dispatch success rate
- load test with realistic customer/rider ratios
- graceful socket reconnect replay using last event id or order snapshot
- rate limits per rider/customer/API key

## Production Run Notes

After deploying Phase 1:

```bash
npm install
npm run migration:run
npm run build
npm run start:dev
```

For real production use a process manager/container command instead of `start:dev`.

Also ensure:

- `REDIS_URL` points to shared Redis used by all backend instances.
- all app instances use the same `JWT_SECRET`.
- load balancer supports WebSocket upgrade.
- database migration runs once before new app version receives traffic.
