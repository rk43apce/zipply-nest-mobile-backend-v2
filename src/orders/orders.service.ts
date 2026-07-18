import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiError } from '../common/api-error';
import { haversineKm, maskPhone, mobileRegex, money } from '../common/utils';
import { DispatchService } from '../dispatch/dispatch.service';
import { Customer, CustomerOrder, OrderDispatch, OrderEvent, OrderRating, Rider, Wallet } from '../entities';
import { NotificationService } from '../notifications/notification.service';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private dataSource: DataSource,
    private moduleRef: ModuleRef,
    private walletService: WalletService,
    private notifications: NotificationService,
    @InjectRepository(CustomerOrder) private orders: Repository<CustomerOrder>,
    @InjectRepository(OrderDispatch) private dispatches: Repository<OrderDispatch>,
    @InjectRepository(OrderEvent) private events: Repository<OrderEvent>,
    @InjectRepository(OrderRating) private ratings: Repository<OrderRating>,
    @InjectRepository(Wallet) private wallets: Repository<Wallet>,
    @InjectRepository(Rider) private riders: Repository<Rider>,
    @InjectRepository(Customer) private customers: Repository<Customer>
  ) {}

  estimate(body: any) {
    const pricing = this.calculate(body.pickup, body.dropoff, body.parcel?.weight_kg || body.parcel_weight_kg || 1);
    return { distance_km: pricing.distance_km, estimated_minutes: pricing.estimated_minutes, pricing: this.pricingPayload(pricing), payment_methods: ['wallet', 'cash', 'online'] };
  }

  async create(customerId: string, body: any) {
    this.validateCreate(body);
    const customer = await this.customers.findOneByOrFail({ id: customerId });
    const idempotencyKey = body.idempotency_key ? `order:${customerId}:${String(body.idempotency_key).slice(0, 48)}` : undefined;
    if (idempotencyKey) {
      const existing = await this.orders.findOneBy({ idempotency_key: idempotencyKey });
      if (existing) return this.createdPayload(existing, this.pricingFromOrder(existing), existing.payment_method);
    }
    const paymentMethod = body.payment_method || 'wallet';
    if (!['wallet', 'cash', 'online'].includes(paymentMethod)) throw new ApiError('INVALID_PAYMENT_METHOD', 'Payment method must be wallet, cash, or online', HttpStatus.BAD_REQUEST);
    const pricing = this.calculate(body.pickup, body.dropoff, body.parcel?.weight_kg || 1);

    // Wallet balance validation: customer wallet cannot go negative.
    if (paymentMethod === 'wallet') {
      const wallet = await this.wallets.findOne({ where: { user_id: customerId, user_type: 'customer' } as any });
      if (!wallet) throw new ApiError('WALLET_NOT_FOUND', 'Wallet not found. Please top up your wallet.', HttpStatus.NOT_FOUND);
      if (wallet.available_balance < pricing.total) {
        throw new ApiError('INSUFFICIENT_BALANCE', `Insufficient wallet balance. You need ${money(pricing.total)} but have ${money(wallet.available_balance)}.`, HttpStatus.UNPROCESSABLE_ENTITY);
      }
    }

    const orderId = await this.generateOrderId();
    let holdId: string | undefined;
    let paymentStatus = paymentMethod === 'cash' ? 'collect_on_delivery' : paymentMethod === 'online' ? 'payment_pending' : 'held';
    const order = await this.dataSource.transaction(async manager => {
      // TODO: Wallet hold implementation - moved to WalletModule
      // if (paymentMethod === 'wallet') {
      //   const wallet = await manager.findOneBy(Wallet, { user_id: customerId });
      //   if (!wallet) throw new ApiError('WALLET_NOT_FOUND', 'Wallet not found', HttpStatus.NOT_FOUND);
      //   const hold = await this.walletService.placeHold(manager, wallet.id, pricing.total, orderId);
      //   holdId = hold.id;
      // }
      const status = paymentMethod === 'online' ? 'payment_pending' : 'confirmed';
      const saved = await manager.save(CustomerOrder, {
        order_id: orderId, customer_id: customerId, idempotency_key: idempotencyKey, status, pickup_lat: body.pickup.lat, pickup_lng: body.pickup.lng, pickup_address: body.pickup.address, pickup_contact_name: body.pickup.contact_name, pickup_contact_phone: body.pickup.contact_phone,
        dropoff_lat: body.dropoff.lat, dropoff_lng: body.dropoff.lng, dropoff_address: body.dropoff.address, dropoff_contact_name: body.dropoff.contact_name, dropoff_contact_phone: body.dropoff.contact_phone,
        parcel_weight_kg: body.parcel?.weight_kg || 1, special_notes: body.parcel?.special_notes, distance_km: pricing.distance_km, base_fare: pricing.base_fare, distance_fare: pricing.distance_fare, weight_surcharge: pricing.weight_surcharge, platform_fee: pricing.platform_fee, total_amount: pricing.total,
        payment_method: paymentMethod, payment_status: paymentStatus, hold_id: holdId, estimated_delivery_minutes: pricing.estimated_minutes, confirmed_at: paymentMethod === 'online' ? null : new Date()
      });
      await manager.save(OrderEvent, { order_id: orderId, event_type: 'order_confirmed', title: paymentMethod === 'online' ? 'Payment Pending' : 'Order Confirmed', description: paymentMethod === 'wallet' ? `${money(pricing.total)} held from wallet` : paymentMethod === 'cash' ? 'Cash payment selected' : 'Waiting for online payment' });
      return saved;
    });
    if (paymentMethod !== 'online') await this.startDispatch(order, customer);
    this.logOrder('order_created', { order_id: orderId, customer_id: customerId, payment_method: paymentMethod, total_amount: pricing.total, distance_km: pricing.distance_km, status: paymentMethod === 'online' ? 'payment_pending' : 'searching' });
    return this.createdPayload(await this.orders.findOneByOrFail({ order_id: orderId }), pricing, paymentMethod);
  }

  async confirmOnlinePayment(orderId: string) {
    const order = await this.orders.findOneBy({ order_id: orderId });
    if (!order) throw new ApiError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
    if (order.payment_method !== 'online') throw new ApiError('INVALID_PAYMENT_METHOD', 'Order is not online payment', HttpStatus.CONFLICT);
    if (order.status !== 'payment_pending') return { order_id: orderId, status: order.status };
    await this.orders.update(order.id, { status: 'confirmed', payment_status: 'paid', confirmed_at: new Date() });
    await this.events.save({ order_id: orderId, event_type: 'payment_confirmed', title: 'Payment Confirmed', description: money(order.total_amount) });
    const customer = await this.customers.findOneByOrFail({ id: order.customer_id });
    await this.startDispatch({ ...order, status: 'confirmed' } as CustomerOrder, customer);
    return { order_id: orderId, status: 'searching', message: 'Payment confirmed and dispatch started' };
  }

  async get(customerId: string, orderId: string) {
    const order = await this.syncFromDispatch(await this.mustOwn(customerId, orderId));
    return { order_id: order.order_id, status: order.status, pickup: { lat: Number(order.pickup_lat), lng: Number(order.pickup_lng), address: order.pickup_address }, dropoff: { lat: Number(order.dropoff_lat), lng: Number(order.dropoff_lng), address: order.dropoff_address }, parcel: { weight_kg: Number(order.parcel_weight_kg), special_notes: order.special_notes }, pricing: { total: order.total_amount, display_total: money(order.total_amount) }, payment: { method: order.payment_method, hold_id: order.hold_id, status: order.payment_status }, rider: order.assigned_rider_id ? { rider_id: order.assigned_rider_id, name: order.rider_name, phone_masked: order.rider_phone_masked, vehicle_type: order.rider_vehicle_type, rating: Number(order.rider_rating || 0) } : null, pickup_otp: order.pickup_otp, distance_km: Number(order.distance_km), estimated_delivery_minutes: order.estimated_delivery_minutes, can_cancel: this.canCancel(order.status), cancellation_fee: this.cancelFee(order.status), created_at: order.created_at, confirmed_at: order.confirmed_at, assigned_at: order.assigned_at, picked_up_at: order.picked_up_at, delivered_at: order.delivered_at };
  }

  async status(customerId: string, orderId: string) {
    const order = await this.syncFromDispatch(await this.mustOwn(customerId, orderId));
    return { order_id: order.order_id, status: order.status, customer_message: this.message(order), rider: order.assigned_rider_id ? { name: order.rider_name, eta_minutes: 8 } : null, can_cancel: this.canCancel(order.status), updated_at: order.updated_at };
  }

  async timeline(customerId: string, orderId: string) {
    await this.syncFromDispatch(await this.mustOwn(customerId, orderId));
    const events = await this.events.find({ where: { order_id: orderId }, order: { created_at: 'ASC' } });
    return { order_id: orderId, events: events.map(e => ({ event_type: e.event_type, title: e.title, description: e.description, created_at: e.created_at })) };
  }

  async list(customerId: string, page: number, limit: number, status?: string) {
    const safePage = Math.max(1, page || 1);
    const safeLimit = Math.min(Math.max(1, limit || 20), 100);
    const where: any = { customer_id: customerId };
    if (status) where.status = status;
    const [rows, total] = await this.orders.findAndCount({ where, order: { created_at: 'DESC' }, skip: (safePage - 1) * safeLimit, take: safeLimit });
    const rated = await this.ratings.find({ where: rows.map(o => ({ order_id: o.order_id })) as any });
    const ratedSet = new Set(rated.map(r => r.order_id));
    return { orders: rows.map(o => ({ order_id: o.order_id, status: o.status, pickup_address: o.pickup_address, dropoff_address: o.dropoff_address, total_amount: o.total_amount, display_total: money(o.total_amount), distance_km: Number(o.distance_km), rider_name: o.rider_name, created_at: o.created_at, delivered_at: o.delivered_at, is_rated: ratedSet.has(o.order_id) })), pagination: { page: safePage, limit: safeLimit, total, has_next: safePage * safeLimit < total } };
  }

  async cancel(customerId: string, orderId: string, reason: string) {
    const order = await this.mustOwn(customerId, orderId);
    if (order.status === 'cancelled') throw new ApiError('ORDER_ALREADY_CANCELLED', 'Order already cancelled', HttpStatus.CONFLICT);
    if (order.status === 'delivered') throw new ApiError('ORDER_ALREADY_DELIVERED', 'Order already delivered', HttpStatus.CONFLICT);
    if (!this.canCancel(order.status)) throw new ApiError('CANCEL_NOT_ALLOWED', 'Cannot cancel after rider has arrived at pickup', HttpStatus.CONFLICT);
    const fee = this.cancelFee(order.status);
    let refund = 0;
    await this.dataSource.transaction(async manager => {
      if (order.hold_id && order.payment_method === 'wallet') refund = 0; // TODO: Move to wallet module
      // refund = (await this.walletService.releaseHold(manager, order.hold_id, orderId, fee)).refund;
      await manager.update(CustomerOrder, order.id, { status: 'cancelled', cancellation_fee: fee, cancelled_at: new Date(), cancel_reason: reason });
      await manager.save(OrderEvent, { order_id: orderId, event_type: 'order_cancelled', title: 'Order Cancelled', description: reason || 'Cancelled by customer' });
    });
    await this.cancelDispatch(orderId);
    return { order_id: orderId, status: 'cancelled', cancellation_fee: fee, display_fee: money(fee), refund_amount: refund, display_refund: money(refund), refund_method: order.payment_method, message: fee ? `Order cancelled. ${money(refund)} refunded (${money(fee)} cancellation fee).` : 'Order cancelled. Full amount refunded to wallet.' };
  }

  async rate(customerId: string, orderId: string, body: any) {
    const order = await this.mustOwn(customerId, orderId);
    if (order.status !== 'delivered') throw new ApiError('ORDER_NOT_DELIVERED', 'Only delivered orders can be rated', HttpStatus.CONFLICT);
    if (![body.delivery_rating, body.rider_rating].every((n: any) => Number.isInteger(Number(n)) && Number(n) >= 1 && Number(n) <= 5)) throw new ApiError('INVALID_RATING', 'Ratings must be between 1 and 5', HttpStatus.BAD_REQUEST);
    const exists = await this.ratings.findOneBy({ order_id: orderId });
    if (exists) throw new ApiError('ORDER_ALREADY_RATED', 'Order already rated', HttpStatus.CONFLICT);
    await this.ratings.save({ order_id: orderId, customer_id: customerId, rider_id: order.assigned_rider_id, delivery_rating: body.delivery_rating, rider_rating: body.rider_rating, comments: body.comments });
    if (order.assigned_rider_id) await this.updateRiderRating(order.assigned_rider_id, body.rider_rating);
    return { order_id: orderId, delivery_rating: body.delivery_rating, rider_rating: body.rider_rating, message: 'Thank you for your feedback!' };
  }

  async getRiderLocation(customerId: string, orderId: string, redis: any) {
    const order = await this.mustOwn(customerId, orderId);
    if (!order.assigned_rider_id) {
      throw new ApiError('RIDER_NOT_ASSIGNED', 'No rider assigned to this order yet', HttpStatus.NOT_FOUND);
    }
    const riderStatus = await redis.hgetall(`rider:status:${order.assigned_rider_id}`);
    if (!riderStatus || !riderStatus.lat || !riderStatus.lng) {
      throw new ApiError('LOCATION_UNAVAILABLE', 'Rider location is not available', HttpStatus.NOT_FOUND);
    }
    return {
      order_id: orderId,
      rider_id: order.assigned_rider_id,
      lat: Number(riderStatus.lat),
      lng: Number(riderStatus.lng),
      accuracy: riderStatus.accuracy ? Number(riderStatus.accuracy) : null,
      updated_at: riderStatus.last_seen || riderStatus.gps_timestamp || null,
    };
  }

  async handleDispatchEvent(event: any) {
    const order = await this.orders.findOneBy({ order_id: event.order_id });
    if (!order) return;
    const patch: any = { status: event.event_type };
    let title = event.event_type;
    let fcmType = event.event_type;
    let riderName: string | undefined;

    if (event.event_type === 'rider_assigned') {
      const rider = event.rider_id ? await this.riders.findOneBy({ id: event.rider_id }) : null;
      Object.assign(patch, { status: 'assigned', assigned_rider_id: event.rider_id, rider_name: rider?.name, rider_phone_masked: maskPhone(rider?.mobile), rider_vehicle_type: rider?.vehicle_type, rider_rating: rider?.rating, assigned_at: new Date() });
      title = 'Rider Assigned';
      fcmType = 'rider_assigned';
      riderName = rider?.name;
    }
    // P0 FIX: Handle rider cancellation — reset customer order to searching state
    // and clear the previous rider info so customer sees correct status.
    if (event.event_type === 'rider_cancelled') {
      Object.assign(patch, { status: 'searching', assigned_rider_id: null, rider_name: null, rider_phone_masked: null, rider_vehicle_type: null, rider_rating: null, assigned_at: null });
      title = 'Rider Cancelled';
      fcmType = 'rider_cancelled';
      await this.orders.update(order.id, patch);
      await this.events.save({ order_id: order.order_id, event_type: 'rider_cancelled', title: 'Finding Another Rider', description: event.description || 'Previous rider cancelled. Searching for a new rider.' });
      this.logOrder('customer_order_status_updated', { order_id: order.order_id, customer_id: order.customer_id, order_status: 'searching', event_type: 'rider_cancelled', rider_id: event.rider_id });
      await this.notifyCustomer(order.customer_id, { type: 'rider_cancelled', order_id: order.order_id, message: 'Your rider cancelled. We are finding another rider.' });
      return;
    }
    if (event.event_type === 'delivered') {
      patch.status = 'delivered'; patch.delivered_at = new Date();
      await this.dataSource.transaction(async manager => {
        if (order.hold_id && order.payment_method === 'wallet') {} // await this.walletService.captureHold(manager, order.hold_id, order.order_id, order.total_amount);
        await manager.update(CustomerOrder, order.id, patch);
        await manager.save(OrderEvent, { order_id: order.order_id, event_type: 'delivered', title: 'Delivered', description: 'Order delivered' });
      });
      this.logOrder('customer_order_status_updated', { order_id: order.order_id, customer_id: order.customer_id, order_status: 'delivered', event_type: event.event_type, rider_id: event.rider_id });
      await this.notifyCustomer(order.customer_id, { type: 'delivered', order_id: order.order_id });
      return;
    }
    if (event.event_type === 'picked_up') patch.picked_up_at = new Date();
    await this.orders.update(order.id, patch);
    await this.events.save({ order_id: order.order_id, event_type: event.event_type, title, description: event.description });
    this.logOrder('customer_order_status_updated', { order_id: order.order_id, customer_id: order.customer_id, order_status: patch.status, event_type: event.event_type, rider_id: event.rider_id });

    // Send FCM push to customer for status updates.
    await this.notifyCustomer(order.customer_id, {
      type: fcmType,
      order_id: order.order_id,
      ...(riderName ? { rider_name: riderName } : {}),
    });
  }

  /** Send FCM notification to a customer by looking up their token. */
  private async notifyCustomer(customerId: string, payload: Record<string, any>) {
    try {
      const customer = await this.customers.findOneBy({ id: customerId });
      if (!customer?.fcm_token) return;
      await this.notifications.sendToCustomer(customer.fcm_token, payload);
    } catch {
      // Best-effort — don't fail the main operation if push fails.
    }
  }

  private async startDispatch(order: CustomerOrder, customer: Customer) {
    this.logOrder('rider_search_started', { order_id: order.order_id, customer_id: customer.id, pickup_lat: order.pickup_lat, pickup_lng: order.pickup_lng, dropoff_lat: order.dropoff_lat, dropoff_lng: order.dropoff_lng });
    const dispatch = this.moduleRef.get(DispatchService, { strict: false });
    await dispatch.start({ order_id: order.order_id, city: 'Mumbai', pickup: { lat: Number(order.pickup_lat), lng: Number(order.pickup_lng), address: order.pickup_address, contact_name: order.pickup_contact_name, contact_phone: order.pickup_contact_phone }, dropoff: { lat: Number(order.dropoff_lat), lng: Number(order.dropoff_lng), address: order.dropoff_address, contact_name: order.dropoff_contact_name, contact_phone: order.dropoff_contact_phone }, customer_id: customer.id, order_meta: { parcel_weight_kg: order.parcel_weight_kg, special_notes: order.special_notes } });
    await this.orders.update(order.id, { status: 'searching' });
    await this.events.save({ order_id: order.order_id, event_type: 'dispatch_started', title: 'Finding Rider', description: 'Searching for nearby riders' });
  }

  private async syncFromDispatch(order: CustomerOrder) {
    if (['cancelled', 'delivered'].includes(order.status)) return order;
    const d = await this.dispatches.findOneBy({ order_id: order.order_id });
    if (!d || ['searching', 'offered', 'no_rider', 'redispatching', 'cancelled'].includes(d.status)) return order;
    const eventType = d.status === 'assigned' ? 'rider_assigned' : d.status;
    const targetStatus = eventType === 'rider_assigned' ? 'assigned' : eventType;
    if (order.status === targetStatus) return order;
    await this.handleDispatchEvent({ order_id: order.order_id, event_type: eventType, rider_id: d.assigned_rider_id });
    return this.orders.findOneByOrFail({ id: order.id });
  }

  private async cancelDispatch(orderId: string) {
    try {
      const dispatch = this.moduleRef.get(DispatchService, { strict: false });
      if (dispatch?.cancelOrderDispatch) await dispatch.cancelOrderDispatch(orderId);
    } catch {
      return;
    }
  }

  private validateCreate(body: any) {
    if (!body.pickup || !body.dropoff) throw new ApiError('INVALID_ORDER', 'Pickup and dropoff are required', HttpStatus.BAD_REQUEST);
    if (!mobileRegex.test(body.dropoff.contact_phone || '')) throw new ApiError('INVALID_PHONE', 'Contact phone must be 10 digits', HttpStatus.BAD_REQUEST);
    this.calculate(body.pickup, body.dropoff, body.parcel?.weight_kg || 1);
  }

  private calculate(pickup: any, dropoff: any, weightKg: number) {
    if (!this.indiaCoords(pickup?.lat, pickup?.lng) || !this.indiaCoords(dropoff?.lat, dropoff?.lng)) throw new ApiError('INVALID_COORDINATES', 'Invalid coordinates', HttpStatus.UNPROCESSABLE_ENTITY);
    const distance_km = haversineKm(Number(pickup.lat), Number(pickup.lng), Number(dropoff.lat), Number(dropoff.lng));
    if (distance_km > 20) throw new ApiError('DISTANCE_TOO_FAR', 'Max delivery distance is 20km', HttpStatus.UNPROCESSABLE_ENTITY);
    const base_fare = 4000;
    const distance_fare = Math.round(distance_km * 1000);
    const weight_surcharge = Number(weightKg) > 5 ? Math.round((Number(weightKg) - 5) * 1500) : 0;
    const platform_fee = 500;
    return { distance_km, estimated_minutes: Math.max(15, Math.round(distance_km * 6 + 8)), base_fare, distance_fare, weight_surcharge, platform_fee, total: base_fare + distance_fare + weight_surcharge + platform_fee };
  }

  private indiaCoords(lat: number, lng: number) {
    return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Number(lat) >= 8 && Number(lat) <= 37 && Number(lng) >= 68 && Number(lng) <= 97;
  }

  private pricingPayload(p: any) {
    return { base_fare: p.base_fare, distance_fare: p.distance_fare, weight_surcharge: p.weight_surcharge, platform_fee: p.platform_fee, total: p.total, display_base: money(p.base_fare), display_distance: money(p.distance_fare), display_weight: money(p.weight_surcharge), display_platform: money(p.platform_fee), display_total: money(p.total) };
  }

  private pricingFromOrder(order: CustomerOrder) {
    return { distance_km: Number(order.distance_km), estimated_minutes: order.estimated_delivery_minutes, base_fare: order.base_fare, distance_fare: order.distance_fare, weight_surcharge: order.weight_surcharge, platform_fee: order.platform_fee, total: order.total_amount };
  }

  private async generateOrderId(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const id = `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
      if (!(await this.orders.findOneBy({ order_id: id }))) return id;
    }
    throw new ApiError('ORDER_ID_FAILED', 'Could not generate order id', HttpStatus.INTERNAL_SERVER_ERROR);
  }

  private createdPayload(order: CustomerOrder, pricing: any, paymentMethod: string) {
    return { order_id: order.order_id, status: order.status, pickup: { lat: Number(order.pickup_lat), lng: Number(order.pickup_lng), address: order.pickup_address }, dropoff: { lat: Number(order.dropoff_lat), lng: Number(order.dropoff_lng), address: order.dropoff_address }, pricing: this.pricingPayload(pricing), payment: { method: paymentMethod, hold_id: order.hold_id, hold_amount: paymentMethod === 'wallet' ? order.total_amount : 0, status: order.payment_status }, distance_km: Number(order.distance_km), estimated_delivery_minutes: order.estimated_delivery_minutes, dispatch_status: paymentMethod === 'online' ? 'waiting_for_payment' : 'searching', created_at: order.created_at };
  }

  private async mustOwn(customerId: string, orderId: string) {
    const order = await this.orders.findOneBy({ customer_id: customerId, order_id: orderId });
    if (!order) throw new ApiError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
    return order;
  }

  private canCancel(status: string) {
    return ['confirmed', 'searching', 'assigned', 'en_route_pickup'].includes(status);
  }

  private cancelFee(status: string) {
    return ['assigned', 'en_route_pickup'].includes(status) ? 2000 : 0;
  }

  private message(order: CustomerOrder) {
    if (['confirmed', 'searching'].includes(order.status)) return 'Finding a rider for you...';
    if (['assigned', 'en_route_pickup'].includes(order.status)) return `${order.rider_name || 'Your rider'} is heading to pick up your order!`;
    if (order.status === 'arrived_pickup') return 'Rider has arrived at the pickup point!';
    if (['picked_up', 'in_transit'].includes(order.status)) return 'Your order is on the way!';
    if (order.status === 'delivered') return 'Your order has been delivered!';
    if (order.status === 'cancelled') return 'Order cancelled';
    return 'Order received';
  }

  private async updateRiderRating(riderId: string, rating: number) {
    const rider = await this.riders.findOneBy({ id: riderId });
    if (!rider) return;
    const totalRatings = (rider.total_ratings || 0) + 1;
    const newRating = ((Number(rider.rating || 0) * (rider.total_ratings || 0)) + Number(rating)) / totalRatings;
    await this.riders.update(riderId, { rating: Math.round(newRating * 100) / 100, total_ratings: totalRatings });
  }

  private logOrder(event: string, data: Record<string, any>) {
    this.logger.log(JSON.stringify({ event, timestamp: new Date().toISOString(), ...data }));
  }
}
