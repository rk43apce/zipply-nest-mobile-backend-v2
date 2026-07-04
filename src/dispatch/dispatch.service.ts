import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { In, Repository } from 'typeorm';
import { REDIS } from '../common/redis.provider';
import { ApiError } from '../common/api-error';
import { hasValidCoordinates, haversineKm, maskPhone, money } from '../common/utils';
import { CustomerOrder, DispatchEvent, DispatchOffer, OrderDispatch, Rider, RiderEarning } from '../entities';
import { OrdersService } from '../orders/orders.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const phaseConfig: any = { 1: [2, 1, 30], 2: [3, 3, 25], 3: [5, 5, 20], 4: [8, 20, 15] };
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class DispatchService {
  constructor(
    @InjectRepository(Rider) private riders: Repository<Rider>,
    @InjectRepository(OrderDispatch) private dispatches: Repository<OrderDispatch>,
    @InjectRepository(DispatchOffer) private offers: Repository<DispatchOffer>,
    @InjectRepository(DispatchEvent) private events: Repository<DispatchEvent>,
    @InjectRepository(RiderEarning) private earnings: Repository<RiderEarning>,
    @InjectRepository(CustomerOrder) private customerOrders: Repository<CustomerOrder>,
    @Inject(REDIS) private redis: Redis,
    @InjectQueue('telemetry') private telemetry: Queue,
    private gateway: RealtimeGateway,
    private moduleRef: ModuleRef
  ) {}

  async online(b: any) {
    const rider = await this.riders.findOneBy({ id: b.rider_id });
    if (!rider || rider.onboarding_status !== 'activated') throw new ApiError('RIDER_NOT_ACTIVATED', 'Rider is not activated', HttpStatus.FORBIDDEN);
    if (!hasValidCoordinates(Number(b.lat), Number(b.lng))) throw new ApiError('INVALID_COORDINATES', 'Invalid coordinates', HttpStatus.UNPROCESSABLE_ENTITY);
    const now = new Date().toISOString();
    await this.redis.geoadd(`riders:online:${b.city}`, b.lng, b.lat, b.rider_id);
    await this.redis.hset(`rider:status:${b.rider_id}`, { status: 'available', city: b.city, lat: b.lat, lng: b.lng, last_seen: now, online_since: now, vehicle_type: b.vehicle_type, max_parcel_weight_kg: b.max_parcel_weight_kg });
    await this.offerWaitingDispatches(b.city);
    return { rider_id: b.rider_id, status: 'available', city: b.city, online_since: now };
  }

  async offline(riderId: string) {
    const st = await this.redis.hgetall(`rider:status:${riderId}`);
    const pending = await this.redis.get(`rider:offered:${riderId}`);
    if (pending) await this.reject(pending, riderId, 'offline');
    if (st.city) await this.redis.zrem(`riders:online:${st.city}`, riderId);
    await this.redis.del(`rider:status:${riderId}`);
    return { rider_id: riderId, status: 'offline', offline_at: new Date().toISOString(), pending_offer_auto_rejected: !!pending };
  }

  async location(b: any) {
    if (await this.redis.get(`rate:location:${b.rider_id}`)) throw new ApiError('RATE_LIMITED', 'Max 1 update per 3 seconds', HttpStatus.TOO_MANY_REQUESTS);
    if (!hasValidCoordinates(Number(b.lat), Number(b.lng))) throw new ApiError('INVALID_COORDINATES', 'Invalid coordinates', HttpStatus.UNPROCESSABLE_ENTITY);
    await this.redis.set(`rate:location:${b.rider_id}`, '1', 'EX', 3);
    const now = new Date().toISOString();
    const st = await this.redis.hgetall(`rider:status:${b.rider_id}`);
    const movedKm = Number.isFinite(Number(st.lat)) && Number.isFinite(Number(st.lng)) ? haversineKm(Number(st.lat), Number(st.lng), Number(b.lat), Number(b.lng)) : Infinity;
    const elapsedMs = Date.now() - Date.parse(st.last_location_persisted_at || st.last_seen || '0');
    if (movedKm < 0.03 && elapsedMs < 15000) {
      await this.redis.hset(`rider:status:${b.rider_id}`, { city: b.city, lat: b.lat, lng: b.lng, last_seen: now });
      return { updated_at: now, skipped_heavy_update: true };
    }
    await this.redis.geoadd(`riders:online:${b.city}`, b.lng, b.lat, b.rider_id);
    await this.redis.hset(`rider:status:${b.rider_id}`, { city: b.city, lat: b.lat, lng: b.lng, last_seen: now, last_location_persisted_at: now });
    await this.telemetry.add('location', b);
    await this.offerWaitingDispatches(b.city);
    return { updated_at: now };
  }

  async start(b: any) {
    const distance = haversineKm(b.pickup.lat, b.pickup.lng, b.dropoff.lat, b.dropoff.lng);
    const weightKg = Number(b.order_meta?.parcel_weight_kg || 2);
    const weightSurcharge = weightKg > 5 ? Math.round((weightKg - 5) * 1500) : 0;
    const estimated = 4000 + Math.round(distance * 1000) + weightSurcharge;
    const d = await this.dispatches.save({ order_id: b.order_id, city: b.city, pickup_lat: b.pickup.lat, pickup_lng: b.pickup.lng, pickup_address: b.pickup.address, pickup_contact_name: b.pickup.contact_name, pickup_contact_phone: b.pickup.contact_phone, dropoff_lat: b.dropoff.lat, dropoff_lng: b.dropoff.lng, dropoff_address: b.dropoff.address, dropoff_contact_name: b.dropoff.contact_name, dropoff_contact_phone: b.dropoff.contact_phone, customer_id: b.customer_id, parcel_weight_kg: b.order_meta?.parcel_weight_kg || 2, requires_heavy_vehicle: !!b.order_meta?.requires_heavy_vehicle, special_notes: b.order_meta?.special_notes, distance_km: distance, estimated_earnings: estimated, status: 'searching', phase: 1 });
    await this.events.save({ dispatch_id: d.id, order_id: d.order_id, event_type: 'dispatch_started', phase: 1 });
    await this.offerPhase(d.id, []);
    return { dispatch_id: d.id, order_id: d.order_id, status: 'searching', phase: 1, search_radius_km: 2.0, estimated_assignment_seconds: 90 };
  }

  async offerPhase(dispatchId: string, excluded: string[] = []) {
    const d = await this.dispatches.findOneBy({ id: dispatchId });
    if (!d || ['assigned', 'delivered', 'cancelled'].includes(d.status)) return;
    if (!(await this.isCustomerOrderDispatchable(d))) {
      await this.cancelDispatch(d, 'customer_order_not_dispatchable');
      return;
    }
    const [radius, limit, timeout] = phaseConfig[d.phase] || [];
    if (!radius) { await this.dispatches.update(d.id, { status: 'no_rider' }); return; }
    const nearby = await this.redis.geosearch(`riders:online:${d.city}`, 'FROMLONLAT', Number(d.pickup_lng), Number(d.pickup_lat), 'BYRADIUS', radius, 'km', 'ASC', 'COUNT', limit * 4);
    const selected: string[] = [];
    for (const riderId of nearby as string[]) {
      if (excluded.includes(riderId) || selected.length >= limit) continue;
      const st = await this.redis.hgetall(`rider:status:${riderId}`);
      if (st.status !== 'available') continue;
      if (Date.now() - Date.parse(st.last_seen || '0') > 5 * 60000) continue;
      if (Number(st.max_parcel_weight_kg || 0) < Number(d.parcel_weight_kg)) continue;
      selected.push(riderId);
    }
    if (!selected.length) { await this.dispatches.update(d.id, { phase: d.phase + 1 }); return this.offerPhase(d.id, excluded); }
    for (const riderId of selected) {
      const expires = new Date(Date.now() + timeout * 1000);
      const offer = await this.offers.save({ dispatch_id: d.id, order_id: d.order_id, rider_id: riderId, phase: d.phase, distance_km: d.distance_km, estimated_earnings: d.estimated_earnings, timeout_seconds: timeout, expires_at: expires });
      await this.redis.hset(`rider:status:${riderId}`, { status: 'busy' });
      await this.redis.set(`rider:offered:${riderId}`, offer.id, 'EX', timeout);
      await this.redis.set(`offer:timer:${offer.id}`, riderId, 'EX', timeout);
      this.gateway.emitToRider(riderId, 'order_offer', this.offerPayload(d, offer));
    }
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

  private async offerWaitingDispatches(city: string) {
    const waiting = await this.dispatches.find({
      where: [
        { city, status: 'searching' },
        { city, status: 'redispatching' },
        { city, status: 'no_rider' }
      ],
      order: { started_at: 'DESC' },
      take: 10
    });
    for (const d of waiting) {
      await this.dispatches.update(d.id, { status: 'searching', phase: 1 });
      await this.offerPhase(d.id, []);
    }
  }

  async accept(offerId: string, riderId: string) {
    if (!uuidRegex.test(offerId || '')) throw new ApiError('INVALID_OFFER_ID', 'Valid offer_id is required', HttpStatus.BAD_REQUEST);
    if (!uuidRegex.test(riderId || '')) throw new ApiError('INVALID_RIDER_ID', 'Valid rider_id is required', HttpStatus.BAD_REQUEST);
    const offer = await this.offers.findOneBy({ id: offerId });
    if (!offer) throw new ApiError('OFFER_NOT_FOUND', 'Offer not found', HttpStatus.NOT_FOUND);
    if (offer.rider_id !== riderId) throw new ApiError('OFFER_NOT_FOUND', 'Offer not found', HttpStatus.NOT_FOUND);
    if (offer.status === 'accepted') {
      const existing = await this.dispatches.findOneByOrFail({ id: offer.dispatch_id });
      if (existing.assigned_rider_id === riderId) return this.assignmentPayload(existing, offer);
    }
    if (offer.status !== 'pending') throw new ApiError('OFFER_ALREADY_RESPONDED', 'Offer already responded', HttpStatus.CONFLICT);
    if (offer.expires_at < new Date()) throw new ApiError('OFFER_EXPIRED', 'Offer expired', HttpStatus.UNPROCESSABLE_ENTITY);
    const d = await this.dispatches.findOneByOrFail({ id: offer.dispatch_id });
    const won = await this.redis.set(`order_lock:${offer.order_id}`, riderId, 'EX', 300, 'NX');
    if (!won) {
      const lockOwner = await this.redis.get(`order_lock:${offer.order_id}`);
      if (lockOwner === riderId && d.assigned_rider_id === riderId) return this.assignmentPayload(d, offer);
      await this.offers.update(offerId, { status: 'cancelled', responded_at: new Date() });
      await this.redis.hset(`rider:status:${riderId}`, { status: 'available' });
      await this.redis.del(`rider:offered:${riderId}`);
      return { assigned: false, offer_id: offerId, message: 'Order was taken by another rider' };
    }
    await this.offers.update(offerId, { status: 'accepted', responded_at: new Date() });
    await this.dispatches.update(d.id, { status: 'assigned', assigned_rider_id: riderId, assigned_at: new Date() });
    const others = await this.offers.find({ where: { order_id: d.order_id, status: 'pending' } });
    await this.offers.update({ order_id: d.order_id, status: 'pending' }, { status: 'cancelled' });
    for (const o of others.filter(o => o.rider_id !== riderId)) { await this.redis.hset(`rider:status:${o.rider_id}`, { status: 'available' }); this.gateway.emitToRider(o.rider_id, 'offer_cancelled', { offer_id: o.id, reason: 'assigned_to_other' }); }
    await this.redis.hset(`rider:status:${riderId}`, { status: 'on_trip', current_order_id: d.order_id });
    await this.redis.del(`rider:offered:${riderId}`);
    await this.events.save({ dispatch_id: d.id, order_id: d.order_id, event_type: 'rider_assigned', rider_id: riderId, phase: offer.phase });
    await this.notifyOrder({ order_id: d.order_id, event_type: 'rider_assigned', rider_id: riderId });
    const payload = this.assignmentPayload(d, offer);
    this.gateway.emitToRider(riderId, 'order_assigned_confirmed', payload);
    this.gateway.emitToCustomer(d.customer_id, 'rider_assigned', payload);
    return payload;
  }

  async reject(offerId: string, riderId: string, reason = 'other') {
    await this.offers.update({ id: offerId, rider_id: riderId }, { status: 'rejected', reason, responded_at: new Date() });
    const offer = await this.offers.findOneBy({ id: offerId });
    if (offer) await this.dispatches.increment({ id: offer.dispatch_id }, 'riders_rejected_count', 1);
    await this.redis.hset(`rider:status:${riderId}`, { status: 'available' });
    await this.redis.del(`rider:offered:${riderId}`);
    return { offer_id: offerId, message: 'Offer declined' };
  }

  async transition(orderId: string, riderId: string, from: string | string[], to: string) {
    const d = await this.mustAssigned(orderId, riderId);
    if (!(Array.isArray(from) ? from : [from]).includes(d.status)) throw new ApiError('INVALID_STATE', 'Cannot transition from current delivery state', HttpStatus.CONFLICT);
    const now = new Date();
    const patch: any = { status: to };
    if (to === 'en_route_pickup') patch.en_route_at = now;
    if (to === 'arrived_pickup') patch.arrived_pickup_at = now;
    if (to === 'picked_up') patch.picked_up_at = now;
    if (to === 'in_transit') patch.in_transit_at = now;
    await this.dispatches.update(d.id, patch);
    await this.events.save({ dispatch_id: d.id, order_id: orderId, event_type: to, rider_id: riderId });
    await this.notifyOrder({ order_id: orderId, event_type: to, rider_id: riderId });
    this.gateway.emitToCustomer(d.customer_id, 'dispatch_update', { order_id: orderId, status: to, message: to });
    const messages: any = { en_route_pickup: { message: 'Rider is heading to pickup', customer_message: 'Your rider is heading to pick up your order!' }, arrived_pickup: { arrival_recorded_at: now, customer_notified: true, wait_timeout_minutes: 10, message: 'Waiting for parcel. Customer has been notified.' }, picked_up: { picked_up_at: now, customer_message: 'Your order has been picked up!' }, in_transit: { customer_message: 'Your order is on the way!' } };
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
      await this.offerPhase(d.id, [b.rider_id]);
      return { cancelled: true, redispatching: true, redispatch_attempt: d.redispatch_count + 1, max_attempts: 3, rider_compensation: comp, display_compensation: money(comp), customer_message: 'Assigning a better-suited rider...' };
    }
    await this.dispatches.update(d.id, { status: 'cancelled', cancelled_at: new Date() });
    return { cancelled: true, redispatching: false, order_cancelled: true, reason: b.reason_code, rider_compensation: comp, display_compensation: money(comp), customer_message: 'Order cancelled. Full refund issued.' };
  }

  async delivered(b: any) {
    const d = await this.mustAssigned(b.order_id, b.rider_id);
    if (d.status === 'delivered') return this.deliveredPayload(d, new Date());
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
    await this.redis.hset(`rider:status:${b.rider_id}`, { status: 'available', current_order_id: '' });
    await this.redis.del(`order_lock:${d.order_id}`);
    return this.deliveredPayload(d, now, total, duration, wait);
  }

  async cancelOrderDispatch(orderId: string, reason = 'customer_cancelled') {
    const d = await this.dispatches.findOneBy({ order_id: orderId });
    if (!d || ['delivered', 'cancelled'].includes(d.status)) return;
    await this.cancelDispatch(d, reason);
  }

  async status(riderId: string) {
    const st = await this.redis.hgetall(`rider:status:${riderId}`);
    if (st.current_order_id) {
      const d = await this.dispatches.findOneBy({ order_id: st.current_order_id });
      return { rider_id: riderId, status: st.status || 'on_trip', current_order_id: st.current_order_id, active_delivery: d ? this.activeDelivery(d) : null };
    }
    return { rider_id: riderId, status: st.status || 'offline', city: st.city, lat: Number(st.lat), lng: Number(st.lng), last_seen: st.last_seen, current_order_id: null, online_since: st.online_since };
  }

  async expireOffers() {
    const expired = await this.offers.find({ where: { status: 'pending' }, take: 100 });
    for (const o of expired.filter(o => o.expires_at <= new Date())) {
      await this.offers.update(o.id, { status: 'timeout', responded_at: new Date() });
      await this.redis.hset(`rider:status:${o.rider_id}`, { status: 'available' });
      await this.redis.del(`rider:offered:${o.rider_id}`);
      this.gateway.emitToRider(o.rider_id, 'offer_cancelled', { offer_id: o.id, reason: 'timeout' });
      const pending = await this.offers.count({ where: { dispatch_id: o.dispatch_id, status: 'pending' } });
      if (!pending) {
        const d = await this.dispatches.findOneBy({ id: o.dispatch_id });
        if (d && d.phase < 4) { await this.dispatches.update(d.id, { phase: d.phase + 1, status: 'searching' }); await this.offerPhase(d.id, []); }
        else if (d) await this.dispatches.update(d.id, { status: 'no_rider' });
      }
    }
  }

  private async mustAssigned(orderId: string, riderId: string) {
    const d = await this.dispatches.findOneBy({ order_id: orderId });
    if (!d || d.assigned_rider_id !== riderId) throw new ApiError('ORDER_NOT_ASSIGNED', 'Rider is not assigned to this order', HttpStatus.NOT_FOUND);
    return d;
  }
  private async notifyOrder(event: any) {
    try {
      const orders = this.moduleRef.get<OrdersService>(OrdersService, { strict: false });
      if (orders?.handleDispatchEvent) await orders.handleDispatchEvent(event);
    } catch {
      return;
    }
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
      await this.redis.hset(`rider:status:${offer.rider_id}`, { status: 'available' });
      await this.redis.del(`rider:offered:${offer.rider_id}`);
      this.gateway.emitToRider(offer.rider_id, 'offer_cancelled', { offer_id: offer.id, reason });
    }
    this.gateway.emitToCustomer(d.customer_id, 'dispatch_update', { order_id: d.order_id, status: 'cancelled', message: reason });
  }
  private offerPayload(d: OrderDispatch, o: DispatchOffer) {
    const platformFee = 500;
    const riderEarnings = d.estimated_earnings || 0;
    const customerFare = riderEarnings + platformFee;
    return { type: 'order_offer', offer_id: o.id, order_id: d.order_id, pickup: { lat: Number(d.pickup_lat), lng: Number(d.pickup_lng), address: d.pickup_address }, dropoff: { lat: Number(d.dropoff_lat), lng: Number(d.dropoff_lng), address: d.dropoff_address }, distance_km: Number(d.distance_km), estimated_earnings: riderEarnings, display_earnings: money(riderEarnings), customer_fare: customerFare, display_customer_fare: money(customerFare), platform_fee: platformFee, display_platform_fee: money(platformFee), timeout_seconds: o.timeout_seconds, expires_at: o.expires_at, special_notes: d.special_notes, parcel_weight_kg: Number(d.parcel_weight_kg) };
  }
  private deliveredPayload(d: OrderDispatch, deliveredAt: Date, total = d.estimated_earnings || 0, duration: number | null = null, wait = 0) {
    const distanceBonus = Math.max(0, total - 4000);
    return { order_id: d.order_id, delivered_at: deliveredAt, earnings: { base_fare: 4000, distance_bonus: distanceBonus, surge_bonus: 0, total, display_total: money(total) }, trip_summary: { distance_km: Number(d.distance_km), duration_minutes: duration, pickup_wait_minutes: wait }, rider_status_after: 'available', customer_notified: true };
  }
  private assignmentPayload(d: OrderDispatch, o: DispatchOffer) { return { assigned: true, order_id: d.order_id, offer_id: o.id, dispatch_id: d.id, pickup: { lat: Number(d.pickup_lat), lng: Number(d.pickup_lng), address: d.pickup_address, contact_name: d.pickup_contact_name, contact_phone: d.pickup_contact_phone }, dropoff: { lat: Number(d.dropoff_lat), lng: Number(d.dropoff_lng), address: d.dropoff_address, contact_name: d.dropoff_contact_name, contact_phone_masked: maskPhone(d.dropoff_contact_phone) }, distance_km: Number(d.distance_km), estimated_earnings: d.estimated_earnings, special_notes: d.special_notes, navigation_url: `https://maps.google.com/?q=${d.pickup_lat},${d.pickup_lng}` }; }
  private activeDelivery(d: OrderDispatch) { return { order_id: d.order_id, dispatch_id: d.id, delivery_status: d.status, pickup: { lat: Number(d.pickup_lat), lng: Number(d.pickup_lng), address: d.pickup_address, contact_name: d.pickup_contact_name, contact_phone: d.pickup_contact_phone }, dropoff: { lat: Number(d.dropoff_lat), lng: Number(d.dropoff_lng), address: d.dropoff_address, contact_name: d.dropoff_contact_name, contact_phone_masked: maskPhone(d.dropoff_contact_phone) }, distance_km: Number(d.distance_km), estimated_earnings: d.estimated_earnings, special_notes: d.special_notes, assigned_at: d.assigned_at }; }
}
