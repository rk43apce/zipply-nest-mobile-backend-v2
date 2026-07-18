import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { REDIS } from '../common/redis.provider';
import { ApiError } from '../common/api-error';
import { hasValidCoordinates, haversineKm, maskPhone, money } from '../common/utils';
import { AcceptHint, Customer, CustomerOrder, DispatchEvent, DispatchOffer, OrderDispatch, Rider, RiderEarning } from '../entities';
import { OrdersService } from '../orders/orders.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationService } from '../notifications/notification.service';

const phaseConfig: any = { 1: [2, 1, 30], 2: [3, 3, 25], 3: [5, 5, 20], 4: [8, 20, 15] };
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const onlineRidersGeoKey = 'riders:online';
const testOfferTimeoutSeconds = 120;
const activeTripStatuses = ['assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'in_transit'];

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    @InjectRepository(Rider) private riders: Repository<Rider>,
    @InjectRepository(OrderDispatch) private dispatches: Repository<OrderDispatch>,
    @InjectRepository(DispatchOffer) private offers: Repository<DispatchOffer>,
    @InjectRepository(DispatchEvent) private events: Repository<DispatchEvent>,
    @InjectRepository(RiderEarning) private earnings: Repository<RiderEarning>,
    @InjectRepository(Customer) private customers: Repository<Customer>,
    @InjectRepository(CustomerOrder) private customerOrders: Repository<CustomerOrder>,
    @Inject(REDIS) private redis: Redis,
    @InjectQueue('telemetry') private telemetry: Queue,
    private gateway: RealtimeGateway,
    private notifications: NotificationService,
    private moduleRef: ModuleRef
  ) {}

  async online(b: any) {
    const rider = await this.riders.findOneBy({ id: b.rider_id });
    if (!rider || rider.onboarding_status !== 'activated') throw new ApiError('RIDER_NOT_ACTIVATED', 'Rider is not activated', HttpStatus.FORBIDDEN);
    const location = this.realRiderLocation(b);
    if (!hasValidCoordinates(location.lat, location.lng)) throw new ApiError('INVALID_COORDINATES', 'Invalid coordinates', HttpStatus.UNPROCESSABLE_ENTITY);
    // The mobile availability flow only needs to send identity and live GPS.
    // Profile attributes are authoritative in Postgres and must never become
    // undefined Redis arguments when older/lightweight clients omit them.
    const city = rider.city || b.city || '';
    const vehicleType = rider.vehicle_type || b.vehicle_type || 'bike';
    const maxParcelWeightKg = Number(rider.max_parcel_weight_kg ?? b.max_parcel_weight_kg ?? 10);
    const now = new Date().toISOString();
    await this.redis.geoadd(onlineRidersGeoKey, location.lng, location.lat, b.rider_id);
    const active = await this.findActiveTripForRider(b.rider_id);
    const onTrip = !!active;
    await this.redis.hset(`rider:status:${b.rider_id}`, { status: onTrip ? 'on_trip' : 'available', city, lat: location.lat, lng: location.lng, accuracy: location.accuracy ?? '', gps_timestamp: location.gps_timestamp ?? '', last_seen: now, online_since: now, vehicle_type: vehicleType, max_parcel_weight_kg: maxParcelWeightKg, current_order_id: onTrip ? active.order_id : '' });
    this.logDispatch('ZipplyBackendReceivedRiderLocation', { rider_id: b.rider_id, source: 'online', city, lat: location.lat, lng: location.lng, accuracy: location.accuracy ?? null, gps_timestamp: location.gps_timestamp ?? null, received_at: now });
    this.logDispatch('ZipplyRedisUpdatedRiderLocation', { rider_id: b.rider_id, redis_key: `rider:status:${b.rider_id}`, geo_key: onlineRidersGeoKey, lat: location.lat, lng: location.lng, updated_at: now });
    this.logDispatch('rider_online', { rider_id: b.rider_id, status: onTrip ? 'on_trip' : 'available', active_order_id: active?.order_id, city, lat: location.lat, lng: location.lng, accuracy: location.accuracy ?? null });
    // Only re-match waiting orders if rider is NOT on a trip (i.e., newly available)
    if (!onTrip) {
      await this.offerWaitingDispatches();
    }
    return { rider_id: b.rider_id, status: onTrip ? 'on_trip' : 'available', city, lat: location.lat, lng: location.lng, accuracy: location.accuracy ?? null, gps_timestamp: location.gps_timestamp ?? null, online_since: now };
  }

  async offline(riderId: string) {
    const st = await this.redis.hgetall(`rider:status:${riderId}`);
    const pending = await this.redis.get(`rider:offered:${riderId}`);
    if (pending) await this.reject(pending, riderId, 'offline');
    await this.redis.zrem(onlineRidersGeoKey, riderId);
    if (st.city) await this.redis.zrem(`riders:online:${st.city}`, riderId);
    await this.redis.del(`rider:status:${riderId}`);
    return { rider_id: riderId, status: 'offline', offline_at: new Date().toISOString(), pending_offer_auto_rejected: !!pending };
  }

  async testFcm(b: any) {
    const riderId = b?.rider_id?.toString();
    if (!riderId) throw new ApiError('RIDER_ID_REQUIRED', 'rider_id is required', HttpStatus.BAD_REQUEST);

    const rider = await this.riders.findOneBy({ id: riderId });
    if (!rider) throw new ApiError('RIDER_NOT_FOUND', 'Rider not found', HttpStatus.NOT_FOUND);

    const paymentMethod = b?.payment_method?.toString() || 'prepaid';
    const customerId = b?.customer_id?.toString();
    if (paymentMethod === 'cash' && !customerId) {
      throw new ApiError('CUSTOMER_ID_REQUIRED', 'customer_id is required for a cash test order', HttpStatus.BAD_REQUEST);
    }
    const customer = customerId ? await this.customers.findOneBy({ id: customerId }) : null;
    if (customerId && !customer) throw new ApiError('CUSTOMER_NOT_FOUND', 'Customer not found', HttpStatus.NOT_FOUND);
    if (!['cash', 'prepaid'].includes(paymentMethod)) {
      throw new ApiError('INVALID_PAYMENT_METHOD', 'payment_method must be cash or prepaid', HttpStatus.BAD_REQUEST);
    }

    const offerId = b?.offer_id?.toString() || randomUUID();
    const orderId = b?.order_id?.toString() || randomUUID();
    const timeoutSeconds = Number(b?.timeout_seconds || 120);
    const displayEarnings = b?.display_earnings?.toString() || '₹25.00';
    const displayCustomerFare = b?.display_customer_fare?.toString() || '₹30.00';
    const displayPlatformFee = b?.display_platform_fee?.toString() || '₹5.00';
    const now = new Date();
    const expiresAt = new Date(now.getTime() + timeoutSeconds * 1000).toISOString();

    const payload = {
      offer_id: offerId,
      order_id: orderId,
      order_reference: this.displayOrderReference(orderId),
      offer_created_at: now.toISOString(),
      offer_expires_at: expiresAt,
      pickup: {
        lat: Number(b?.pickup_lat ?? 19.076),
        lng: Number(b?.pickup_lng ?? 72.8777),
        address: b?.pickup_address?.toString() || 'Test pickup location',
        contact_name: b?.pickup_contact_name?.toString() || 'Test Pickup',
        contact_phone: b?.pickup_contact_phone?.toString() || '9999999999',
      },
      dropoff: {
        lat: Number(b?.dropoff_lat ?? 19.088),
        lng: Number(b?.dropoff_lng ?? 72.8877),
        address: b?.dropoff_address?.toString() || 'Test dropoff location',
        contact_name: b?.dropoff_contact_name?.toString() || 'Test Dropoff',
        contact_phone_masked: b?.dropoff_contact_phone_masked?.toString() || '******9999',
      },
      distance_km: Number(b?.distance_km ?? 2.4),
      estimated_earnings: Number(b?.estimated_earnings ?? 2500),
      display_earnings: displayEarnings,
      customer_fare: Number(b?.customer_fare ?? 3000),
      display_customer_fare: displayCustomerFare,
      platform_fee: Number(b?.platform_fee ?? 500),
      display_platform_fee: displayPlatformFee,
      timeout_seconds: timeoutSeconds,
      expires_at: expiresAt,
      server_sent_at: now.toISOString(),
      special_notes: b?.special_notes?.toString() || 'Manual FCM test',
      parcel_weight_kg: Number(b?.parcel_weight_kg ?? 2),
      payment_method: paymentMethod,
      source: 'manual_test',
    };

    if (await this.dispatches.existsBy({ order_id: orderId })) {
      throw new ApiError('ORDER_ALREADY_EXISTS', 'A dispatch with this order_id already exists', HttpStatus.CONFLICT);
    }

    if (paymentMethod === 'cash') {
      const customerFare = payload.customer_fare;
      const platformFee = payload.platform_fee;
      const baseFare = Math.min(4000, Math.max(0, customerFare - platformFee));
      await this.customerOrders.save({
        order_id: orderId,
        customer_id: customer!.id,
        status: 'searching',
        pickup_lat: payload.pickup.lat,
        pickup_lng: payload.pickup.lng,
        pickup_address: payload.pickup.address,
        pickup_contact_name: payload.pickup.contact_name,
        pickup_contact_phone: payload.pickup.contact_phone,
        dropoff_lat: payload.dropoff.lat,
        dropoff_lng: payload.dropoff.lng,
        dropoff_address: payload.dropoff.address,
        dropoff_contact_name: payload.dropoff.contact_name,
        dropoff_contact_phone: b?.dropoff_contact_phone?.toString() || '9999999999',
        parcel_weight_kg: payload.parcel_weight_kg,
        special_notes: payload.special_notes,
        distance_km: payload.distance_km,
        base_fare: baseFare,
        distance_fare: Math.max(0, customerFare - platformFee - baseFare),
        platform_fee: platformFee,
        total_amount: customerFare,
        payment_method: 'cash',
        payment_status: 'collect_on_delivery',
      });
    }

    // Create a real dispatch and offer record so accept/reject works during testing
    const dispatch = await this.dispatches.save({
      order_id: orderId,
      city: b?.city?.toString() || 'test_city',
      pickup_lat: payload.pickup.lat,
      pickup_lng: payload.pickup.lng,
      pickup_address: payload.pickup.address,
      pickup_contact_name: payload.pickup.contact_name,
      pickup_contact_phone: payload.pickup.contact_phone,
      dropoff_lat: payload.dropoff.lat,
      dropoff_lng: payload.dropoff.lng,
      dropoff_address: payload.dropoff.address,
      dropoff_contact_name: payload.dropoff.contact_name,
      dropoff_contact_phone: payload.dropoff.contact_phone_masked || '9999999999',
      customer_id: customerId || 'test_customer',
      parcel_weight_kg: payload.parcel_weight_kg,
      distance_km: payload.distance_km,
      estimated_earnings: payload.estimated_earnings,
      status: 'offered',
      phase: 1,
    });

    const expires = new Date(now.getTime() + timeoutSeconds * 1000);
    await this.offers.save({
      id: offerId,
      dispatch_id: dispatch.id,
      order_id: orderId,
      rider_id: riderId,
      phase: 1,
      distance_km: payload.distance_km,
      estimated_earnings: payload.estimated_earnings,
      timeout_seconds: timeoutSeconds,
      expires_at: expires,
    });

    // Set rider status to busy so accept logic works
    await this.redis.hset(`rider:status:${riderId}`, { status: 'busy', current_order_id: '' });
    await this.redis.set(`rider:offered:${riderId}`, offerId, 'EX', timeoutSeconds);
    await this.redis.set(`offer:timer:${offerId}`, riderId, 'EX', timeoutSeconds);

    const fcmResult = await this.notifications.sendOrderOffer(rider.fcm_token, payload);
    this.logDispatch('manual_fcm_test_sent', {
      rider_id: riderId,
      offer_id: offerId,
      order_id: orderId,
      has_token: !!rider.fcm_token,
      fcm_attempted: fcmResult.attempted,
      fcm_sent: fcmResult.sent,
      reason: fcmResult.reason,
      message_id: fcmResult.message_id,
      error: fcmResult.error,
    });

    return {
      rider_id: riderId,
      offer_id: offerId,
      order_id: orderId,
      has_token: !!rider.fcm_token,
      notification_type: 'order_offer',
      payment_method: paymentMethod,
      attempted: fcmResult.attempted,
      sent: fcmResult.sent,
      reason: fcmResult.reason,
      message_id: fcmResult.message_id,
      error: fcmResult.error,
      expires_at: expiresAt,
    };
  }

  async location(b: any) {
    if (await this.redis.get(`rate:location:${b.rider_id}`)) throw new ApiError('RATE_LIMITED', 'Max 1 update per 3 seconds', HttpStatus.TOO_MANY_REQUESTS);
    const location = this.realRiderLocation(b);
    if (!hasValidCoordinates(location.lat, location.lng)) throw new ApiError('INVALID_COORDINATES', 'Invalid coordinates', HttpStatus.UNPROCESSABLE_ENTITY);
    await this.redis.set(`rate:location:${b.rider_id}`, '1', 'EX', 3);
    const now = new Date().toISOString();
    const st = await this.redis.hgetall(`rider:status:${b.rider_id}`);
    const clean = await this.reconcileRiderStatus(b.rider_id, st);
    const movedKm = Number.isFinite(Number(clean.lat)) && Number.isFinite(Number(clean.lng)) ? haversineKm(Number(clean.lat), Number(clean.lng), location.lat, location.lng) : Infinity;
    const elapsedMs = Date.now() - Date.parse(clean.last_location_persisted_at || clean.last_seen || '0');
    this.logDispatch('ZipplyBackendReceivedRiderLocation', { rider_id: b.rider_id, source: 'location_update', city: b.city, lat: location.lat, lng: location.lng, accuracy: location.accuracy ?? null, gps_timestamp: location.gps_timestamp ?? null, received_at: now, moved_km: movedKm });
    if (movedKm < 0.03 && elapsedMs < 15000) {
      await this.redis.hset(`rider:status:${b.rider_id}`, { city: b.city, lat: location.lat, lng: location.lng, accuracy: location.accuracy ?? '', gps_timestamp: location.gps_timestamp ?? '', last_seen: now });
      this.logDispatch('ZipplyRedisUpdatedRiderLocation', { rider_id: b.rider_id, redis_key: `rider:status:${b.rider_id}`, lat: location.lat, lng: location.lng, accuracy: location.accuracy ?? null, updated_at: now, skipped_heavy_update: true });
      // P0 FIX: Even on light updates (rider hasn't moved much), still try to
      // match waiting dispatches. The rider is confirmed alive and available —
      // new orders placed since the last update need to find them immediately.
      if (clean.status === 'available' && !clean.current_order_id) {
        await this.offerWaitingDispatches();
      }
      return { updated_at: now, lat: location.lat, lng: location.lng, accuracy: location.accuracy ?? null, gps_timestamp: location.gps_timestamp ?? null, skipped_heavy_update: true };
    }
    await this.redis.geoadd(onlineRidersGeoKey, location.lng, location.lat, b.rider_id);
    await this.redis.hset(`rider:status:${b.rider_id}`, { city: b.city, lat: location.lat, lng: location.lng, accuracy: location.accuracy ?? '', gps_timestamp: location.gps_timestamp ?? '', last_seen: now, last_location_persisted_at: now });
    this.logDispatch('ZipplyRedisUpdatedRiderLocation', { rider_id: b.rider_id, redis_key: `rider:status:${b.rider_id}`, geo_key: onlineRidersGeoKey, lat: location.lat, lng: location.lng, accuracy: location.accuracy ?? null, updated_at: now });
    await this.telemetry.add('location', { ...b, lat: location.lat, lng: location.lng, accuracy: location.accuracy, gps_timestamp: location.gps_timestamp });
    this.logDispatch('ZipplyDbLocationUpdateQueued', { rider_id: b.rider_id, lat: location.lat, lng: location.lng, accuracy: location.accuracy ?? null, gps_timestamp: location.gps_timestamp ?? null });
    await this.offerWaitingDispatches();
    return { updated_at: now, lat: location.lat, lng: location.lng, accuracy: location.accuracy ?? null, gps_timestamp: location.gps_timestamp ?? null };
  }

  async start(b: any) {
    const startedAt = Date.now();
    const distance = haversineKm(b.pickup.lat, b.pickup.lng, b.dropoff.lat, b.dropoff.lng);
    const weightKg = Number(b.order_meta?.parcel_weight_kg || 2);
    const weightSurcharge = weightKg > 5 ? Math.round((weightKg - 5) * 1500) : 0;
    const estimated = 4000 + Math.round(distance * 1000) + weightSurcharge;
    this.logDispatch('dispatch_start_received', { order_id: b.order_id, customer_id: b.customer_id, city: b.city, pickup: b.pickup, dropoff: b.dropoff, parcel_weight_kg: weightKg, distance_km: distance, timestamp: new Date().toISOString() });
    const d = await this.dispatches.save({ order_id: b.order_id, city: b.city, pickup_lat: b.pickup.lat, pickup_lng: b.pickup.lng, pickup_address: b.pickup.address, pickup_contact_name: b.pickup.contact_name, pickup_contact_phone: b.pickup.contact_phone, dropoff_lat: b.dropoff.lat, dropoff_lng: b.dropoff.lng, dropoff_address: b.dropoff.address, dropoff_contact_name: b.dropoff.contact_name, dropoff_contact_phone: b.dropoff.contact_phone, customer_id: b.customer_id, parcel_weight_kg: b.order_meta?.parcel_weight_kg || 2, requires_heavy_vehicle: !!b.order_meta?.requires_heavy_vehicle, special_notes: b.order_meta?.special_notes, distance_km: distance, estimated_earnings: estimated, status: 'searching', phase: 1 });
    await this.events.save({ dispatch_id: d.id, order_id: d.order_id, event_type: 'dispatch_started', phase: 1 });
    const dbSavedAt = Date.now();
    await this.offerPhase(d.id, []);
    const offerPhaseCompletedAt = Date.now();
    this.logDispatch('dispatch_start_completed', { order_id: b.order_id, dispatch_id: d.id, total_ms: offerPhaseCompletedAt - startedAt, db_save_ms: dbSavedAt - startedAt, offer_phase_ms: offerPhaseCompletedAt - dbSavedAt });
    return { dispatch_id: d.id, order_id: d.order_id, status: 'searching', phase: 1, search_radius_km: 2.0, estimated_assignment_seconds: 90 };
  }

  async offerPhase(dispatchId: string, excluded: string[] = []) {
    const phaseStartedAt = Date.now();
    const d = await this.dispatches.findOneBy({ id: dispatchId });
    if (!d || ['assigned', 'delivered', 'cancelled'].includes(d.status)) return;
    this.logDispatch('offer_phase_started', { dispatch_id: dispatchId, order_id: d.order_id, phase: d.phase, excluded_riders: excluded });
    if (!(await this.isCustomerOrderDispatchable(d))) {
      this.logDispatch('dispatch_cancelled_not_dispatchable', { dispatch_id: d.id, order_id: d.order_id, customer_id: d.customer_id });
      await this.cancelDispatch(d, 'customer_order_not_dispatchable');
      return;
    }
    const [radius, limit, configuredTimeout] = phaseConfig[d.phase] || [];
    const timeout = testOfferTimeoutSeconds || configuredTimeout;
    if (!radius) { this.logDispatch('offer_phase_exhausted', { dispatch_id: d.id, order_id: d.order_id, phase: d.phase }); await this.dispatches.update(d.id, { status: 'no_rider' }); return; }
    const geoSearchStartedAt = Date.now();
    const nearby = await this.redis.geosearch(onlineRidersGeoKey, 'FROMLONLAT', Number(d.pickup_lng), Number(d.pickup_lat), 'BYRADIUS', radius, 'km', 'ASC', 'COUNT', limit * 4);
    const geoSearchMs = Date.now() - geoSearchStartedAt;
    this.logDispatch('candidate_riders_found', { dispatch_id: d.id, order_id: d.order_id, phase: d.phase, radius_km: radius, candidate_count: nearby.length, candidate_riders: nearby, geo_search_ms: geoSearchMs });
    const selected: string[] = [];
    for (const riderId of nearby as string[]) {
      if (excluded.includes(riderId)) {
        this.logDispatch('rider_eligibility_decision', { dispatch_id: d.id, order_id: d.order_id, rider_id: riderId, eligible: false, reason: 'excluded' });
        continue;
      }
      if (selected.length >= limit) {
        this.logDispatch('rider_eligibility_decision', { dispatch_id: d.id, order_id: d.order_id, rider_id: riderId, eligible: false, reason: 'phase_limit_reached' });
        continue;
      }
      const st = await this.redis.hgetall(`rider:status:${riderId}`);
      const clean = await this.reconcileRiderStatus(riderId, st);
      if (clean.status !== 'available' || clean.current_order_id) {
        this.logDispatch('rider_eligibility_decision', { dispatch_id: d.id, order_id: d.order_id, rider_id: riderId, eligible: false, reason: 'not_available_or_active_order', status: clean.status, current_order_id: clean.current_order_id || null });
        continue;
      }
      if (Date.now() - Date.parse(clean.last_seen || '0') > 5 * 60000) {
        this.logDispatch('rider_eligibility_decision', { dispatch_id: d.id, order_id: d.order_id, rider_id: riderId, eligible: false, reason: 'stale_location', last_seen: clean.last_seen || null });
        continue;
      }
      if (Number(clean.max_parcel_weight_kg || 0) < Number(d.parcel_weight_kg)) {
        this.logDispatch('rider_eligibility_decision', { dispatch_id: d.id, order_id: d.order_id, rider_id: riderId, eligible: false, reason: 'insufficient_capacity', max_parcel_weight_kg: clean.max_parcel_weight_kg, order_parcel_weight_kg: d.parcel_weight_kg });
        continue;
      }
      this.logDispatch('ZipplyRiderLocationUsedForMatching', { dispatch_id: d.id, order_id: d.order_id, rider_id: riderId, rider_lat: Number(clean.lat), rider_lng: Number(clean.lng), pickup_lat: Number(d.pickup_lat), pickup_lng: Number(d.pickup_lng), last_seen: clean.last_seen || null });
      this.logDispatch('rider_eligibility_decision', { dispatch_id: d.id, order_id: d.order_id, rider_id: riderId, eligible: true });
      selected.push(riderId);
    }
    if (!selected.length) { this.logDispatch('no_eligible_riders_in_phase', { dispatch_id: d.id, order_id: d.order_id, phase: d.phase }); await this.dispatches.update(d.id, { phase: d.phase + 1 }); return this.offerPhase(d.id, excluded); }
    for (const riderId of selected) {
      const expires = new Date(Date.now() + timeout * 1000);
      const offer = await this.offers.save({ dispatch_id: d.id, order_id: d.order_id, rider_id: riderId, phase: d.phase, distance_km: d.distance_km, estimated_earnings: d.estimated_earnings, timeout_seconds: timeout, expires_at: expires });
      this.logDispatch('offer_created', { dispatch_id: d.id, order_id: d.order_id, offer_id: offer.id, rider_id: riderId, phase: d.phase, expires_at: expires.toISOString() });
      await this.redis.hset(`rider:status:${riderId}`, { status: 'busy', current_order_id: '' });
      await this.redis.set(`rider:offered:${riderId}`, offer.id, 'EX', timeout);
      await this.redis.set(`offer:timer:${offer.id}`, riderId, 'EX', timeout);
      await this.flashOfferToRider(riderId, d, offer);
    }
    const offerPhaseMs = Date.now() - phaseStartedAt;
    this.logDispatch('offer_phase_completed', { dispatch_id: d.id, order_id: d.order_id, phase: d.phase, riders_offered: selected.length, total_ms: offerPhaseMs });
    this.gateway.emitToCustomer(d.customer_id, 'rider_offer_sent', {
      order_id: d.order_id,
      status: 'offered',
      phase: d.phase,
      riders_offered: selected.length,
      timeout_seconds: timeout,
      message: selected.length === 1 ? 'Offer sent to a nearby rider' : `Offer sent to ${selected.length} nearby riders`
    });
    await this.dispatches.update(d.id, { status: 'offered', riders_offered_count: d.riders_offered_count + selected.length });
  }

  private async offerWaitingDispatches() {
    const waiting = await this.dispatches.find({
      where: [
        { status: 'searching' },
        { status: 'offered' },
        { status: 'redispatching' },
        { status: 'no_rider' }
      ],
      order: { started_at: 'DESC' },
      take: 10
    });
    for (const d of waiting) {
      if (d.status !== 'offered') await this.dispatches.update(d.id, { status: 'searching', phase: 1 });
      await this.offerPhase(d.id, []);
    }
  }

  async accept(offerId: string, riderId: string, idempotencyKey?: string, clientAcceptedAt?: string) {
    const serverReceivedAt = new Date();
    let orderId: string | null = null;
    let offerExpiresAt: Date | null = null;
    let acceptanceResult = 'INTERNAL_ERROR';
    const clientTime = clientAcceptedAt ? Date.parse(clientAcceptedAt) : NaN;
    const clientToServerDelayMs = Number.isFinite(clientTime) ? serverReceivedAt.getTime() - clientTime : null;
    const logResult = () => this.logDispatch('rider_offer_acceptance_result', {
      order_id: orderId,
      offer_id: offerId,
      rider_id: riderId,
      offer_expires_at: offerExpiresAt?.toISOString() || null,
      client_accepted_at: clientAcceptedAt || null,
      server_received_at: serverReceivedAt.toISOString(),
      client_to_server_delay_ms: clientToServerDelayMs,
      acceptance_result: acceptanceResult,
    });

    if (!uuidRegex.test(offerId || '')) throw new ApiError('INVALID_OFFER_ID', 'Valid offer_id is required', HttpStatus.BAD_REQUEST);
    if (!uuidRegex.test(riderId || '')) throw new ApiError('INVALID_RIDER_ID', 'Valid rider_id is required', HttpStatus.BAD_REQUEST);
    try {
      if (idempotencyKey) {
        const cached = await this.redis.get(`accept:idempotency:${idempotencyKey}`);
        if (cached) {
          const payload = JSON.parse(cached);
          orderId = payload.order_id || null;
          acceptanceResult = 'ACCEPTED';
          logResult();
          return payload;
        }
      }

      const committed = await this.offers.manager.transaction(async manager => {
        const offerRepo = manager.getRepository(DispatchOffer);
        const dispatchRepo = manager.getRepository(OrderDispatch);
        const riderRepo = manager.getRepository(Rider);
        const customerOrderRepo = manager.getRepository(CustomerOrder);
        const eventRepo = manager.getRepository(DispatchEvent);

        const offer = await offerRepo.createQueryBuilder('offer').setLock('pessimistic_write').where('offer.id = :offerId', { offerId }).getOne();
        if (!offer || offer.rider_id !== riderId) throw new ApiError('OFFER_NOT_AVAILABLE', 'Offer is not available', HttpStatus.NOT_FOUND);
        orderId = offer.order_id;
        offerExpiresAt = offer.expires_at;

        const dispatch = await dispatchRepo.createQueryBuilder('dispatch').setLock('pessimistic_write').where('dispatch.id = :dispatchId', { dispatchId: offer.dispatch_id }).getOne();
        if (!dispatch) throw new ApiError('OFFER_NOT_AVAILABLE', 'Offer is not available', HttpStatus.NOT_FOUND);

        if (offer.status === 'accepted' && dispatch.assigned_rider_id === riderId) {
          return { payload: { ...this.assignmentPayload(dispatch, offer), acceptance_result: 'ACCEPTED' }, competitors: [] as DispatchOffer[], dispatch, idempotent: true };
        }

        const graceDeadline = offer.expires_at.getTime() + 5000;
        if (serverReceivedAt.getTime() > graceDeadline) throw new ApiError('OFFER_EXPIRED', 'Offer expired', HttpStatus.UNPROCESSABLE_ENTITY);
        // Expiry workers may mark the offer timeout at the rider-visible
        // deadline. A request already received within the hidden network grace
        // remains eligible; all other terminal states remain unavailable.
        if (!['pending', 'timeout'].includes(offer.status)) throw new ApiError('OFFER_NOT_AVAILABLE', 'Offer is not available', HttpStatus.CONFLICT);

        const customerOrder = dispatch.customer_id
          ? await customerOrderRepo.createQueryBuilder('order').setLock('pessimistic_write').where('order.order_id = :orderId', { orderId: dispatch.order_id }).getOne()
          : null;
        if (dispatch.status === 'cancelled' || customerOrder?.status === 'cancelled') throw new ApiError('ORDER_CANCELLED', 'Order was cancelled', HttpStatus.CONFLICT);
        if (dispatch.status === 'delivered' || customerOrder?.status === 'delivered') throw new ApiError('OFFER_NOT_AVAILABLE', 'Order no longer requires assignment', HttpStatus.CONFLICT);
        if (dispatch.assigned_rider_id && dispatch.assigned_rider_id !== riderId) throw new ApiError('ORDER_ALREADY_ASSIGNED', 'Order already assigned', HttpStatus.CONFLICT);
        if (customerOrder?.assigned_rider_id && customerOrder.assigned_rider_id !== riderId) throw new ApiError('ORDER_ALREADY_ASSIGNED', 'Order already assigned', HttpStatus.CONFLICT);
        if (customerOrder && !['confirmed', 'searching'].includes(customerOrder.status)) throw new ApiError('OFFER_NOT_AVAILABLE', 'Order no longer requires assignment', HttpStatus.CONFLICT);
        if (!['searching', 'offered', 'redispatching', 'no_rider'].includes(dispatch.status)) throw new ApiError('OFFER_NOT_AVAILABLE', 'Order no longer requires assignment', HttpStatus.CONFLICT);

        const rider = await riderRepo.createQueryBuilder('rider').setLock('pessimistic_write').where('rider.id = :riderId', { riderId }).getOne();
        if (!rider || rider.onboarding_status !== 'activated' || Number(rider.max_parcel_weight_kg) < Number(dispatch.parcel_weight_kg)) throw new ApiError('RIDER_NOT_ELIGIBLE', 'Rider is not eligible', HttpStatus.CONFLICT);
        const activeOrder = await dispatchRepo.createQueryBuilder('active').where('active.assigned_rider_id = :riderId', { riderId }).andWhere('active.status IN (:...statuses)', { statuses: activeTripStatuses }).getOne();
        if (activeOrder && activeOrder.id !== dispatch.id) throw new ApiError('RIDER_HAS_ACTIVE_ORDER', 'Rider already has an active order', HttpStatus.CONFLICT);

        const assignedAt = new Date();
        const assignment = await dispatchRepo.createQueryBuilder().update(OrderDispatch).set({ status: 'assigned', assigned_rider_id: riderId, assigned_at: assignedAt }).where('id = :id', { id: dispatch.id }).andWhere('assigned_rider_id IS NULL').execute();
        if (assignment.affected !== 1) throw new ApiError('ORDER_ALREADY_ASSIGNED', 'Order already assigned', HttpStatus.CONFLICT);

        await offerRepo.update(offer.id, { status: 'accepted', responded_at: assignedAt });
        const competitors = await offerRepo.find({ where: { order_id: dispatch.order_id, status: 'pending' } });
        await offerRepo.update({ order_id: dispatch.order_id, status: 'pending' }, { status: 'cancelled', reason: 'assigned_to_other', responded_at: assignedAt });
        if (customerOrder) await customerOrderRepo.update(customerOrder.id, { status: 'assigned', assigned_rider_id: riderId, rider_name: rider.name, rider_phone_masked: maskPhone(rider.mobile), rider_vehicle_type: rider.vehicle_type, rider_rating: rider.rating, assigned_at: assignedAt });
        await eventRepo.save({ dispatch_id: dispatch.id, order_id: dispatch.order_id, event_type: 'rider_assigned', rider_id: riderId, phase: offer.phase });
        Object.assign(dispatch, { status: 'assigned', assigned_rider_id: riderId, assigned_at: assignedAt });
        return { payload: { ...this.assignmentPayload(dispatch, offer), acceptance_result: 'ACCEPTED' }, competitors: competitors.filter(o => o.id !== offer.id), dispatch, idempotent: false };
      });

      const { payload, competitors, dispatch, idempotent } = committed;
      try {
        await this.redis.hset(`rider:status:${riderId}`, { status: 'on_trip', current_order_id: dispatch.order_id });
        await this.redis.del(`rider:offered:${riderId}`);
        if (idempotencyKey) await this.redis.set(`accept:idempotency:${idempotencyKey}`, JSON.stringify(payload), 'EX', 300);
        if (!idempotent) {
          for (const competitor of competitors) {
            await this.redis.hset(`rider:status:${competitor.rider_id}`, { status: 'available', current_order_id: '' });
            await this.cancelOfferFlash(competitor.rider_id, { offer_id: competitor.id, reason: 'assigned_to_other' });
          }
        }
      } catch (error) {
        this.logDispatch('rider_offer_acceptance_post_commit_sync_failed', { order_id: dispatch.order_id, offer_id: offerId, rider_id: riderId, error: error instanceof Error ? error.message : String(error) });
      }
      if (!idempotent) {
        try {
          // Generate pickup OTP for this order assignment
          const pickupOtp = this.generatePickupOtp();
          await this.dispatches.update(dispatch.id, { pickup_otp: pickupOtp });
          await this.customerOrders.update({ order_id: dispatch.order_id }, { pickup_otp: pickupOtp });
          this.logDispatch('pickup_otp_generated', { order_id: dispatch.order_id, dispatch_id: dispatch.id, rider_id: riderId, otp_generated: true });

          await this.notifyOrder({ order_id: dispatch.order_id, event_type: 'rider_assigned', rider_id: riderId });
          await this.confirmAssignmentToRider(riderId, payload);
          this.gateway.emitToCustomer(dispatch.customer_id, 'rider_assigned', { ...payload, pickup_otp: pickupOtp });
        } catch (error) {
          this.logDispatch('rider_offer_acceptance_notification_failed', { order_id: dispatch.order_id, offer_id: offerId, rider_id: riderId, error: error instanceof Error ? error.message : String(error) });
        }
      }
      acceptanceResult = 'ACCEPTED';
      logResult();
      return payload;
    } catch (error) {
      if (error instanceof ApiError) {
        const response = error.getResponse() as any;
        acceptanceResult = response?.code || 'INTERNAL_ERROR';
      }
      logResult();
      throw error;
    }
  }

  async reject(offerId: string, riderId: string, reason = 'other') {
    await this.offers.update({ id: offerId, rider_id: riderId }, { status: 'rejected', reason, responded_at: new Date() });
    const offer = await this.offers.findOneBy({ id: offerId });
    if (offer) await this.dispatches.increment({ id: offer.dispatch_id }, 'riders_rejected_count', 1);
    await this.redis.hset(`rider:status:${riderId}`, { status: 'available', current_order_id: '' });
    await this.redis.del(`rider:offered:${riderId}`);
    
    // P2-1 FIX: Track rejected riders to exclude from next phase
    if (offer) {
      await this.redis.sadd(`dispatch:rejected_riders:${offer.dispatch_id}`, riderId);
    }
    
    return { offer_id: offerId, message: 'Offer declined' };
  }

  async offerAck(offerId: string, riderId: string, source = 'fcm', receivedAt?: string) {
    if (!uuidRegex.test(offerId || '')) throw new ApiError('INVALID_OFFER_ID', 'Valid offer_id is required', HttpStatus.BAD_REQUEST);
    if (!uuidRegex.test(riderId || '')) throw new ApiError('INVALID_RIDER_ID', 'Valid rider_id is required', HttpStatus.BAD_REQUEST);
    const offer = await this.offers.findOneBy({ id: offerId, rider_id: riderId });
    if (!offer) throw new ApiError('OFFER_NOT_FOUND', 'Offer not found', HttpStatus.NOT_FOUND);
    const ackKey = `offer:ack:${riderId}:${offerId}:offer_received`;
    const firstAck = await this.redis.set(ackKey, '1', 'EX', 86400, 'NX');
    if (!firstAck) {
      this.logDispatch('rider_offer_ack_duplicate_ignored', { dispatch_id: offer.dispatch_id, order_id: offer.order_id, offer_id: offerId, rider_id: riderId, source });
      return { offer_id: offerId, rider_id: riderId, acked: true, duplicate: true };
    }
    const ackedAt = receivedAt || new Date().toISOString();
    try {
      await this.events.save({ dispatch_id: offer.dispatch_id, order_id: offer.order_id, event_type: 'offer_received', rider_id: riderId, phase: offer.phase, details: { source, received_at: ackedAt, offer_status: offer.status } });
    } catch (error) {
      await this.redis.del(ackKey);
      throw error;
    }
    this.logDispatch('rider_offer_ack_received', { dispatch_id: offer.dispatch_id, order_id: offer.order_id, offer_id: offerId, rider_id: riderId, source, received_at: ackedAt });
    return { offer_id: offerId, rider_id: riderId, acked: true };
  }

  async transition(orderId: string, riderId: string, from: string | string[], to: string) {
    // Block picked_up transition through generic endpoint — must use OTP verification endpoint
    if (to === 'picked_up') {
      throw new ApiError('OTP_REQUIRED', 'Pickup confirmation requires OTP verification. Use POST /api/dispatch/verify-pickup-otp instead.', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const d = await this.mustAssigned(orderId, riderId);
    if (d.status === to) return { order_id: orderId, status: to, already_applied: true };
    if (!(Array.isArray(from) ? from : [from]).includes(d.status)) throw new ApiError('INVALID_STATE', 'Cannot transition from current delivery state', HttpStatus.CONFLICT);
    const now = new Date();
    const patch: any = { status: to };
    if (to === 'en_route_pickup') patch.en_route_at = now;
    if (to === 'arrived_pickup') patch.arrived_pickup_at = now;
    if (to === 'in_transit') patch.in_transit_at = now;
    await this.dispatches.update(d.id, patch);
    await this.events.save({ dispatch_id: d.id, order_id: orderId, event_type: to, rider_id: riderId });
    await this.notifyOrder({ order_id: orderId, event_type: to, rider_id: riderId });
    this.gateway.emitToCustomer(d.customer_id, 'dispatch_update', { order_id: orderId, status: to, message: to });
    const messages: any = { en_route_pickup: { message: 'Rider is heading to pickup', customer_message: 'Your rider is heading to pick up your order!' }, arrived_pickup: { arrival_recorded_at: now, customer_notified: true, wait_timeout_minutes: 10, message: 'Waiting for parcel. Customer has been notified.' }, in_transit: { customer_message: 'Your order is on the way!' } };
    return { order_id: orderId, status: to, ...messages[to] };
  }

  async cancelPickup(b: any) {
    const redispatchable = ['oversized', 'overweight', 'vehicle_breakdown', 'safety_concern', 'long_wait', 'customer_unreachable'];
    const terminal = ['store_closed', 'item_unavailable'];
    if (![...redispatchable, ...terminal, 'other'].includes(b.reason_code)) throw new ApiError('INVALID_REASON_CODE', 'Invalid reason code', HttpStatus.UNPROCESSABLE_ENTITY);
    const d = await this.mustAssigned(b.order_id, b.rider_id);
    if (!['assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up'].includes(d.status)) throw new ApiError('INVALID_STATE', 'Cannot cancel in current delivery state', HttpStatus.CONFLICT);
    if (d.redispatch_count >= 3) throw new ApiError('MAX_REDISPATCH_REACHED', 'Maximum redispatch attempts reached', HttpStatus.CONFLICT);
    const comp = b.reason_code === 'other' ? 0 : 1500;
    if (comp) await this.earnings.save({ rider_id: b.rider_id, order_id: d.order_id, dispatch_id: d.id, earning_type: 'cancellation_compensation', total: comp });
    await this.redis.hset(`rider:status:${b.rider_id}`, { status: 'available', current_order_id: '' });
    await this.redis.del(`order_lock:${d.order_id}`);
    if (redispatchable.includes(b.reason_code)) {
      await this.dispatches.update(d.id, { status: 'redispatching', redispatch_count: d.redispatch_count + 1, assigned_rider_id: null });
      // P0 FIX: Notify customer that rider cancelled and we're finding another rider.
      // Previously, customer was never informed — they kept seeing the old rider.
      await this.notifyOrder({ order_id: d.order_id, event_type: 'rider_cancelled', rider_id: b.rider_id, description: 'Rider cancelled. Finding another rider.' });
      this.gateway.emitToCustomer(d.customer_id, 'dispatch_update', { order_id: d.order_id, status: 'searching', message: 'rider_cancelled', reason: b.reason_code });
      await this.offerPhase(d.id, [b.rider_id]);
      return { cancelled: true, redispatching: true, redispatch_attempt: d.redispatch_count + 1, max_attempts: 3, rider_compensation: comp, display_compensation: money(comp), customer_message: 'Assigning a better-suited rider...' };
    }
    await this.dispatches.update(d.id, { status: 'cancelled', cancelled_at: new Date() });
    // P0 FIX: Notify customer about terminal cancellation.
    await this.notifyOrder({ order_id: d.order_id, event_type: 'order_cancelled', rider_id: b.rider_id, description: `Rider cancelled: ${b.reason_code}` });
    this.gateway.emitToCustomer(d.customer_id, 'dispatch_update', { order_id: d.order_id, status: 'cancelled', message: 'rider_cancelled', reason: b.reason_code });
    return { cancelled: true, redispatching: false, order_cancelled: true, reason: b.reason_code, rider_compensation: comp, display_compensation: money(comp), customer_message: 'Order cancelled. Full refund issued.' };
  }

  async delivered(b: any) {
    const d = await this.mustAssigned(b.order_id, b.rider_id);
    if (d.status === 'delivered') {
      const completedOrder = await this.customerOrders.findOneBy({ order_id: d.order_id });
      return this.deliveredPayload(d, d.delivered_at || new Date(), d.estimated_earnings, null, 0, completedOrder);
    }
    if (!(await this.isCustomerOrderDispatchable(d))) throw new ApiError('ORDER_NOT_ACTIVE', 'Customer order is not active', HttpStatus.CONFLICT);
    if (!['in_transit', 'picked_up'].includes(d.status)) throw new ApiError('INVALID_STATE', 'Cannot deliver in current delivery state', HttpStatus.CONFLICT);
    const now = new Date();
    const distanceBonus = Math.round(Number(d.distance_km || 0) * 1000);
    const total = 4000 + distanceBonus;
    const duration = d.assigned_at ? Math.round((now.getTime() - d.assigned_at.getTime()) / 60000) : null;
    const wait = d.arrived_pickup_at && d.picked_up_at ? Math.round((d.picked_up_at.getTime() - d.arrived_pickup_at.getTime()) / 60000) : 0;
    await this.dispatches.update(d.id, { status: 'delivered', delivered_at: now });
    await this.earnings.save({ rider_id: b.rider_id, order_id: d.order_id, dispatch_id: d.id, base_fare: 4000, distance_bonus: distanceBonus, total, distance_km: d.distance_km, duration_minutes: duration });
    await this.notifyOrder({ order_id: d.order_id, event_type: 'delivered', rider_id: b.rider_id });
    this.gateway.emitToCustomer(d.customer_id, 'dispatch_update', { order_id: d.order_id, status: 'delivered', message: 'Your order has been delivered!' });
    await this.riders.increment({ id: b.rider_id }, 'total_deliveries', 1);
    await this.redis.hset(`rider:status:${b.rider_id}`, { status: 'available', current_order_id: '', last_seen: now.toISOString() });
    await this.redis.del(`order_lock:${d.order_id}`);
    // P0 FIX: Re-add rider to geo-index so they are immediately findable for next dispatch.
    // Without this, rider stays at their last heavy-update position which may be stale.
    const riderLoc = await this.redis.hgetall(`rider:status:${b.rider_id}`);
    if (riderLoc.lat && riderLoc.lng) {
      await this.redis.geoadd(onlineRidersGeoKey, Number(riderLoc.lng), Number(riderLoc.lat), b.rider_id);
    }
    const order = await this.customerOrders.findOneBy({ order_id: d.order_id });
    this.logDispatch('rider_available_after_delivery', { rider_id: b.rider_id, order_id: d.order_id, status: 'available', lat: riderLoc.lat, lng: riderLoc.lng });
    // P0 FIX: Immediately try to match this rider with any waiting orders.
    // Previously, the rider had to wait for their next location heartbeat before
    // pending orders would discover them — causing 20+ second delays.
    await this.offerWaitingDispatches();
    return this.deliveredPayload(d, now, total, duration, wait, order);
  }

  async cancelOrderDispatch(orderId: string, reason = 'customer_cancelled') {
    const d = await this.dispatches.findOneBy({ order_id: orderId });
    if (!d || ['delivered', 'cancelled'].includes(d.status)) return;
    await this.cancelDispatch(d, reason);
  }

  async status(riderId: string) {
    const st = await this.reconcileRiderStatus(riderId);

    // Stale location timeout: mark rider offline if no location update for 6 hours
    // and rider is not on an active trip.
    const STALE_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6 hours (testing value)
    if (st.status === 'available' && st.last_seen) {
      const lastSeenMs = Date.parse(st.last_seen);
      if (Date.now() - lastSeenMs > STALE_TIMEOUT_MS) {
        this.logDispatch('ZipplyRiderStaleLocationTimeout', {
          rider_id: riderId,
          last_seen: st.last_seen,
          timeout_hours: 6,
          action: 'marking_offline',
        });
        await this.redis.zrem(onlineRidersGeoKey, riderId);
        await this.redis.del(`rider:status:${riderId}`);
        return { rider_id: riderId, status: 'offline', city: st.city, lat: Number(st.lat), lng: Number(st.lng), last_seen: st.last_seen, current_order_id: null, online_since: null, pending_offer: null };
      }
    }

    const pendingOffer = await this.currentOffer(riderId);
    if (st.current_order_id) {
      const d = await this.dispatches.findOneBy({ order_id: st.current_order_id });
      return { rider_id: riderId, status: st.status || 'on_trip', current_order_id: st.current_order_id, active_delivery: d ? this.activeDelivery(d) : null, pending_offer: pendingOffer };
    }
    return { rider_id: riderId, status: st.status || 'offline', city: st.city, lat: Number(st.lat), lng: Number(st.lng), last_seen: st.last_seen, current_order_id: null, online_since: st.online_since, pending_offer: pendingOffer };
  }

  async currentOffer(riderId: string) {
    if (!uuidRegex.test(riderId || '')) throw new ApiError('INVALID_RIDER_ID', 'Valid rider_id is required', HttpStatus.BAD_REQUEST);
    const st = await this.reconcileRiderStatus(riderId);
    if (st.status !== 'busy' || st.current_order_id) return null;
    const redisOfferId = await this.redis.get(`rider:offered:${riderId}`);
    if (!redisOfferId) return null;
    const offer = redisOfferId
      ? await this.offers.findOneBy({ id: redisOfferId, rider_id: riderId, status: 'pending' })
      : null;
    if (!offer || offer.expires_at <= new Date()) return null;
    const d = await this.dispatches.findOneBy({ id: offer.dispatch_id });
    if (!d || ['assigned', 'delivered', 'cancelled'].includes(d.status)) return null;
    return this.offerPayload(d, offer);
  }

  /// Validates if an offer is ready/eligible for a rider when FCM arrives.
  /// Called by app immediately after receiving FCM notification.
  /// Returns complete offer payload if valid, null if offer is not eligible.
  async validateOffer(offerId: string, riderId: string) {
    if (!uuidRegex.test(offerId || '')) throw new ApiError('INVALID_OFFER_ID', 'Valid offer_id is required', HttpStatus.BAD_REQUEST);
    if (!uuidRegex.test(riderId || '')) throw new ApiError('INVALID_RIDER_ID', 'Valid rider_id is required', HttpStatus.BAD_REQUEST);

    // Check if offer exists and belongs to this rider
    const offer = await this.offers.findOneBy({ id: offerId, rider_id: riderId });
    if (!offer) {
      this.logDispatch('ZipplyOfferValidationFailed', { offer_id: offerId, rider_id: riderId, reason: 'offer_not_found' });
      return null;
    }

    // Check if offer is still pending (not expired, not already responded)
    if (offer.status !== 'pending') {
      this.logDispatch('ZipplyOfferValidationFailed', { offer_id: offerId, rider_id: riderId, reason: 'offer_not_pending', offer_status: offer.status });
      return null;
    }

    // Check if offer has expired
    if (offer.expires_at <= new Date()) {
      this.logDispatch('ZipplyOfferValidationFailed', { offer_id: offerId, rider_id: riderId, reason: 'offer_expired', expires_at: offer.expires_at.toISOString() });
      return null;
    }

    // Check if dispatch still exists and is in a valid state
    const d = await this.dispatches.findOneBy({ id: offer.dispatch_id });
    if (!d || ['assigned', 'delivered', 'cancelled'].includes(d.status)) {
      this.logDispatch('ZipplyOfferValidationFailed', { offer_id: offerId, rider_id: riderId, reason: 'dispatch_not_valid', dispatch_status: d?.status || 'not_found' });
      return null;
    }

    // Check if rider is still online/available in Redis
    const riderStatus = await this.redis.hgetall(`rider:status:${riderId}`);
    if (!riderStatus || riderStatus.status !== 'busy') {
      this.logDispatch('ZipplyOfferValidationFailed', { offer_id: offerId, rider_id: riderId, reason: 'rider_not_available', rider_status: riderStatus?.status || 'not_found' });
      return null;
    }

    // Offer is valid — log and return complete payload
    this.logDispatch('ZipplyOfferValidationPassed', { offer_id: offerId, rider_id: riderId, dispatch_id: d.id, order_id: d.order_id });
    return this.offerPayload(d, offer);
  }

  // P0-2 FIX: Active ride recovery endpoint for app crash/resume
  async activeRide(riderId: string) {
    if (!uuidRegex.test(riderId || '')) throw new ApiError('INVALID_RIDER_ID', 'Valid rider_id is required', HttpStatus.BAD_REQUEST);
    const st = await this.reconcileRiderStatus(riderId);
    // Check if rider has an active order
    if (!st.current_order_id) throw new ApiError('NO_ACTIVE_RIDE', 'No active ride found', HttpStatus.NOT_FOUND);
    // Fetch dispatch for current order
    const d = await this.dispatches.findOneBy({ order_id: st.current_order_id, assigned_rider_id: riderId });
    if (!d || ['delivered', 'cancelled'].includes(d.status)) throw new ApiError('NO_ACTIVE_RIDE', 'No active ride found', HttpStatus.NOT_FOUND);
    // Return complete active delivery state
    return {
      order_id: d.order_id,
      dispatch_id: d.id,
      status: d.status,
      phase: d.phase,
      assigned_at: d.assigned_at,
      customer_id: d.customer_id,
      pickup_contact_name: d.pickup_contact_name,
      pickup_contact_phone: d.pickup_contact_phone,
      pickup_address: d.pickup_address,
      pickup_lat: d.pickup_lat,
      pickup_lng: d.pickup_lng,
      dropoff_address: d.dropoff_address,
      dropoff_lat: d.dropoff_lat,
      dropoff_lng: d.dropoff_lng,
      picked_up_at: d.picked_up_at,
      delivered_at: d.delivered_at,
      rider_id: riderId,
      rider_status: st.status
    };
  }

  async expireOffers() {
    const expired = await this.offers.find({ where: { status: 'pending' }, take: 100 });
    // Keep the database offer pending through the hidden transit grace so an
    // already-sent acceptance can be processed before redispatch begins.
    const graceNow = Date.now();
    for (const o of expired.filter(o => o.expires_at.getTime() + 5000 <= graceNow)) {
      await this.offers.update(o.id, { status: 'timeout', responded_at: new Date() });
      await this.redis.hset(`rider:status:${o.rider_id}`, { status: 'available', current_order_id: '' });
      await this.redis.del(`rider:offered:${o.rider_id}`);
      await this.cancelOfferFlash(o.rider_id, { offer_id: o.id, reason: 'timeout' });
      const pending = await this.offers.count({ where: { dispatch_id: o.dispatch_id, status: 'pending' } });
      if (!pending) {
        const d = await this.dispatches.findOneBy({ id: o.dispatch_id });
        if (d && d.phase < 4) {
          // P2-1 FIX: Pass rejected riders to next phase
          const rejectedRiders = await this.redis.smembers(`dispatch:rejected_riders:${d.id}`);
          await this.dispatches.update(d.id, { phase: d.phase + 1, status: 'searching' });
          await this.offerPhase(d.id, rejectedRiders);
        }
        else if (d) await this.dispatches.update(d.id, { status: 'no_rider' });
      }
    }
  }

  private async mustAssigned(orderId: string, riderId: string) {
    const d = await this.dispatches.findOneBy({ order_id: orderId });
    if (!d || d.assigned_rider_id !== riderId) throw new ApiError('ORDER_NOT_ASSIGNED', 'Rider is not assigned to this order', HttpStatus.NOT_FOUND);
    return d;
  }

  /// Auto-cancel dispatches that have been searching for too long without assignment.
  /// Called every 10 seconds by TimeoutProcessor.
  async autoExpireDispatches() {
    const DISPATCH_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
    const staleDispatches = await this.dispatches.find({
      where: [
        { status: 'searching' },
        { status: 'offered' },
        { status: 'no_rider' },
        { status: 'redispatching' },
      ],
      take: 20,
    });

    for (const d of staleDispatches) {
      const age = Date.now() - d.started_at.getTime();
      if (age < DISPATCH_TIMEOUT_MS) continue;

      // Dispatch has exceeded timeout — cancel it
      this.logDispatch('dispatch_auto_expired', {
        dispatch_id: d.id,
        order_id: d.order_id,
        customer_id: d.customer_id,
        status: d.status,
        age_seconds: Math.round(age / 1000),
        phase: d.phase,
        riders_offered: d.riders_offered_count,
        riders_rejected: d.riders_rejected_count,
      });

      await this.cancelDispatch(d, 'search_timeout');

      // Update customer order to cancelled with clear reason
      try {
        await this.customerOrders.update(
          { order_id: d.order_id },
          { status: 'cancelled', cancel_reason: 'No rider available within 3 minutes', cancelled_at: new Date() },
        );
        // Notify customer
        await this.notifyOrder({ order_id: d.order_id, event_type: 'order_cancelled', description: 'No rider found. Order auto-cancelled.' });
      } catch {
        // Best-effort — dispatch is already cancelled
      }
    }
  }
  private async reconcileRiderStatus(riderId: string, existing?: Record<string, string>): Promise<Record<string, string>> {
    const key = `rider:status:${riderId}`;
    const st = existing || await this.redis.hgetall(key);
    const active = await this.findActiveTripForRider(riderId);
    if (active) {
      const repaired: Record<string, string> = { ...st, status: 'on_trip', current_order_id: active.order_id };
      await this.redis.hset(key, repaired);
      this.logDispatch('rider_status_reconciled_from_active_trip', { rider_id: riderId, order_id: active.order_id, previous_status: st.status || null, previous_current_order_id: st.current_order_id || null });
      return repaired;
    }
    if (!Object.keys(st).length) return st;

    const offered = await this.redis.get(`rider:offered:${riderId}`);
    if (offered) {
      const offer = await this.offers.findOneBy({ id: offered, rider_id: riderId, status: 'pending' });
      if (offer && offer.expires_at > new Date()) {
        if (st.status !== 'busy' || st.current_order_id) await this.redis.hset(key, { status: 'busy', current_order_id: '' });
        return { ...st, status: 'busy', current_order_id: '' };
      }
      await this.redis.del(`rider:offered:${riderId}`);
    }

    if (st.current_order_id) {
      const active = await this.dispatches.findOneBy({ order_id: st.current_order_id, assigned_rider_id: riderId });
      if (active && activeTripStatuses.includes(active.status)) {
        if (st.status !== 'on_trip') await this.redis.hset(key, { status: 'on_trip' });
        return { ...st, status: 'on_trip' };
      }
      await this.redis.hset(key, { current_order_id: '' });
      st.current_order_id = '';
    }

    if (st.status === 'busy' || st.status === 'on_trip') {
      await this.redis.hset(key, { status: 'available', current_order_id: '' });
      return { ...st, status: 'available', current_order_id: '' };
    }
    return st;
  }
  private async findActiveTripForRider(riderId: string) {
    const active = await this.dispatches.findOne({ where: { assigned_rider_id: riderId }, order: { assigned_at: 'DESC' } });
    return active && activeTripStatuses.includes(active.status) ? active : null;
  }
  private logDispatch(event: string, data: Record<string, any>) {
    this.logger.log(JSON.stringify({ event, ...data }));
  }
  private async notifyOrder(event: any) {
    try {
      const orders = this.moduleRef.get<OrdersService>(OrdersService, { strict: false });
      if (orders?.handleDispatchEvent) await orders.handleDispatchEvent(event);
    } catch {
      return;
    }
  }
  private async flashOfferToRider(riderId: string, d: OrderDispatch, offer: DispatchOffer) {
    const fcmStartedAt = Date.now();
    const payload = this.offerPayload(d, offer);
    const rider = await this.riders.findOneBy({ id: riderId });
    const fcmResult = await this.notifications.sendOrderOffer(rider?.fcm_token, payload);
    const fcmCompletedAt = Date.now();
    this.logDispatch('fcm_offer_flash_attempted', { dispatch_id: d.id, order_id: d.order_id, offer_id: offer.id, rider_id: riderId, fcm_attempted: fcmResult.attempted, fcm_sent: fcmResult.sent, reason: fcmResult.reason, error: fcmResult.error, message_id: fcmResult.message_id, fcm_latency_ms: fcmCompletedAt - fcmStartedAt, has_token: !!rider?.fcm_token, token_suffix: rider?.fcm_token?.slice(-6) });
    if (this.shouldEmitSocket(fcmResult)) {
      const emitResult = this.gateway.emitToRider(riderId, 'order_offer', payload);
      this.logDispatch('socket_emit_attempted', { dispatch_id: d.id, order_id: d.order_id, offer_id: offer.id, rider_id: riderId, event: 'order_offer', ...emitResult });
    }
  }
  private async cancelOfferFlash(riderId: string, payload: Record<string, any>) {
    const rider = await this.riders.findOneBy({ id: riderId });
    const fcmResult = await this.notifications.sendOfferCancelled(rider?.fcm_token, payload);
    this.logDispatch('fcm_offer_cancel_attempted', { rider_id: riderId, offer_id: payload.offer_id, reason: payload.reason, fcm_attempted: fcmResult.attempted, fcm_sent: fcmResult.sent, error: fcmResult.error });
    if (this.shouldEmitSocket(fcmResult)) {
      this.gateway.emitToRider(riderId, 'offer_cancelled', payload);
    }
  }
  private async confirmAssignmentToRider(riderId: string, payload: Record<string, any>) {
    const rider = await this.riders.findOneBy({ id: riderId });
    const fcmResult = await this.notifications.sendOrderAssigned(rider?.fcm_token, payload);
    this.logDispatch('fcm_assignment_confirm_attempted', { rider_id: riderId, offer_id: payload.offer_id, order_id: payload.order_id, fcm_attempted: fcmResult.attempted, fcm_sent: fcmResult.sent, error: fcmResult.error });
    if (this.shouldEmitSocket(fcmResult)) {
      this.gateway.emitToRider(riderId, 'order_assigned_confirmed', payload);
    }
  }
  private shouldEmitSocket(fcmResult: { sent: boolean }) {
    const mode = (process.env.DISPATCH_OFFER_DELIVERY_MODE || 'dual').toLowerCase();
    if (mode === 'fcm') return !fcmResult.sent;
    if (mode === 'socket') return true;
    return true;
  }
  private async isCustomerOrderDispatchable(d: OrderDispatch) {
    if (!d.customer_id) return true;
    const order = await this.customerOrders.findOneBy({ order_id: d.order_id });
    return !order || !['cancelled', 'delivered', 'payment_pending'].includes(order.status);
  }
  private async cancelDispatch(d: OrderDispatch, reason: string) {
    await this.dispatches.update(d.id, { status: 'cancelled', cancelled_at: new Date() });
    const pending = await this.offers.find({ where: { order_id: d.order_id, status: 'pending' } });
    if (pending.length) await this.offers.update({ order_id: d.order_id, status: 'pending' }, { status: 'cancelled', reason, responded_at: new Date() });
    for (const offer of pending) {
      await this.redis.hset(`rider:status:${offer.rider_id}`, { status: 'available', current_order_id: '' });
      await this.redis.del(`rider:offered:${offer.rider_id}`);
      await this.cancelOfferFlash(offer.rider_id, { offer_id: offer.id, reason });
    }
    this.gateway.emitToCustomer(d.customer_id, 'dispatch_update', { order_id: d.order_id, status: 'cancelled', message: reason });
  }
  private realRiderLocation(body: any) {
    return {
      lat: Number(body.lat),
      lng: Number(body.lng),
      accuracy: Number.isFinite(Number(body.accuracy)) ? Number(body.accuracy) : undefined,
      gps_timestamp: typeof body.gps_timestamp === 'string' ? body.gps_timestamp : undefined,
    };
  }
  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  private offerPayload(d: OrderDispatch, o: DispatchOffer) {
    const platformFee = 500;
    const riderEarnings = d.estimated_earnings || 0;
    const customerFare = riderEarnings + platformFee;
    return { type: 'order_offer', offer_id: o.id, order_id: d.order_id, order_reference: this.displayOrderReference(d.order_id), offer_created_at: o.offered_at, offer_expires_at: o.expires_at, pickup: { lat: Number(d.pickup_lat), lng: Number(d.pickup_lng), address: d.pickup_address, contact_name: d.pickup_contact_name, contact_phone: d.pickup_contact_phone }, dropoff: { lat: Number(d.dropoff_lat), lng: Number(d.dropoff_lng), address: d.dropoff_address, contact_name: d.dropoff_contact_name, contact_phone_masked: maskPhone(d.dropoff_contact_phone) }, distance_km: Number(d.distance_km), estimated_earnings: riderEarnings, display_earnings: money(riderEarnings), customer_fare: customerFare, display_customer_fare: money(customerFare), platform_fee: platformFee, display_platform_fee: money(platformFee), timeout_seconds: o.timeout_seconds, expires_at: o.expires_at, server_sent_at: new Date(), special_notes: d.special_notes, parcel_weight_kg: Number(d.parcel_weight_kg) };
  }
  private displayOrderReference(orderId: string) {
    let hash = 2166136261;
    for (const code of orderId) {
      hash ^= code.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `ZPL-${String(hash >>> 0).padStart(9, '0').slice(-9)}`;
  }
  private deliveredPayload(d: OrderDispatch, deliveredAt: Date, total = d.estimated_earnings || 0, duration: number | null = null, wait = 0, order?: CustomerOrder | null) {
    const distanceBonus = Math.max(0, total - 4000);
    return { order_id: d.order_id, delivered_at: deliveredAt, earnings: { base_fare: 4000, distance_bonus: distanceBonus, surge_bonus: 0, total, display_total: money(total) }, trip_summary: { distance_km: Number(d.distance_km), duration_minutes: duration, pickup_wait_minutes: wait }, rider_status_after: 'available', customer_notified: true, payment_method: order?.payment_method || 'prepaid', cash_confirmation: order?.payment_method === 'cash' ? { cash_amount: Number(order.total_amount), display_cash_amount: money(Number(order.total_amount)), commission_amount: Number(order.platform_fee), display_commission: money(Number(order.platform_fee)) } : null };
  }
  private assignmentPayload(d: OrderDispatch, o: DispatchOffer) { return { assigned: true, order_id: d.order_id, offer_id: o.id, dispatch_id: d.id, pickup: { lat: Number(d.pickup_lat), lng: Number(d.pickup_lng), address: d.pickup_address, contact_name: d.pickup_contact_name, contact_phone: d.pickup_contact_phone }, dropoff: { lat: Number(d.dropoff_lat), lng: Number(d.dropoff_lng), address: d.dropoff_address, contact_name: d.dropoff_contact_name, contact_phone_masked: maskPhone(d.dropoff_contact_phone) }, distance_km: Number(d.distance_km), estimated_earnings: d.estimated_earnings, special_notes: d.special_notes, navigation_url: `https://maps.google.com/?q=${d.pickup_lat},${d.pickup_lng}` }; }
  private activeDelivery(d: OrderDispatch) { return { order_id: d.order_id, dispatch_id: d.id, delivery_status: d.status, pickup: { lat: Number(d.pickup_lat), lng: Number(d.pickup_lng), address: d.pickup_address, contact_name: d.pickup_contact_name, contact_phone: d.pickup_contact_phone }, dropoff: { lat: Number(d.dropoff_lat), lng: Number(d.dropoff_lng), address: d.dropoff_address, contact_name: d.dropoff_contact_name, contact_phone_masked: maskPhone(d.dropoff_contact_phone) }, distance_km: Number(d.distance_km), estimated_earnings: d.estimated_earnings, special_notes: d.special_notes, navigation_url: `https://maps.google.com/?q=${d.pickup_lat},${d.pickup_lng}`, assigned_at: d.assigned_at }; }

  // ---------------------------------------------------------------------------
  // Pickup OTP
  // ---------------------------------------------------------------------------

  private generatePickupOtp(): string {
    return String(Math.floor(1000 + Math.random() * 9000)); // 4-digit OTP
  }

  async verifyPickupOtp(orderId: string, riderId: string, otp: string) {
    if (!otp || otp.length < 4) throw new ApiError('INVALID_OTP', 'Please enter a valid 4-digit OTP', HttpStatus.BAD_REQUEST);
    const d = await this.mustAssigned(orderId, riderId);

    // Idempotent: if already verified, return success
    if (d.pickup_otp_verified_at) {
      return { order_id: orderId, verified: true, already_verified: true, verified_at: d.pickup_otp_verified_at };
    }

    // Must be in arrived_pickup state (rider is at pickup location)
    if (!['arrived_pickup', 'en_route_pickup', 'assigned'].includes(d.status)) {
      throw new ApiError('INVALID_STATE', 'Pickup OTP can only be verified at pickup location', HttpStatus.CONFLICT);
    }

    // Validate OTP matches
    if (!d.pickup_otp) {
      throw new ApiError('OTP_NOT_GENERATED', 'No pickup OTP was generated for this order', HttpStatus.CONFLICT);
    }
    if (d.pickup_otp !== otp.trim()) {
      this.logDispatch('pickup_otp_verification_failed', { order_id: orderId, rider_id: riderId, dispatch_id: d.id, reason: 'otp_mismatch' });
      throw new ApiError('INVALID_OTP', 'Incorrect OTP. Please check with the sender.', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    // OTP matches — mark as verified and transition to picked_up
    const now = new Date();
    await this.dispatches.update(d.id, { pickup_otp_verified_at: now, status: 'picked_up', picked_up_at: now });
    await this.customerOrders.update({ order_id: orderId }, { pickup_otp_verified_at: now, picked_up_at: now, status: 'picked_up' });
    await this.events.save({ dispatch_id: d.id, order_id: orderId, event_type: 'picked_up', rider_id: riderId });
    await this.notifyOrder({ order_id: orderId, event_type: 'picked_up', rider_id: riderId });
    this.gateway.emitToCustomer(d.customer_id, 'dispatch_update', { order_id: orderId, status: 'picked_up', message: 'Parcel picked up' });
    this.logDispatch('pickup_otp_verified', { order_id: orderId, rider_id: riderId, dispatch_id: d.id, verified_at: now.toISOString() });

    return { order_id: orderId, verified: true, status: 'picked_up', picked_up_at: now.toISOString() };
  }
}
