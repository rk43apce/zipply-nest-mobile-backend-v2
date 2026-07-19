import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiError } from '../common/api-error';
import { money } from '../common/utils';
import { TripPayment, Wallet, BusinessRule, CustomerOrder, OrderDispatch, WalletTransaction } from '../entities';
import { CommissionEngine } from './commission.engine';

@Injectable()
export class CashPaymentService {
  constructor(
    private dataSource: DataSource,
    @InjectRepository(TripPayment) private tripPayments: Repository<TripPayment>,
    @InjectRepository(Wallet) private wallets: Repository<Wallet>,
    @InjectRepository(BusinessRule) private rules: Repository<BusinessRule>,
    @InjectRepository(CustomerOrder) private orders: Repository<CustomerOrder>,
    @InjectRepository(OrderDispatch) private dispatches: Repository<OrderDispatch>,
    private commissionEngine: CommissionEngine
  ) {}

  async confirmOrderCash(riderId: string, orderId: string, idempotencyKey: string) {
    if (!idempotencyKey) throw new ApiError('IDEMPOTENCY_REQUIRED', 'Idempotency key required', HttpStatus.BAD_REQUEST);
    return this.dataSource.transaction(async manager => {
      const order = await manager.createQueryBuilder(CustomerOrder, 'order').setLock('pessimistic_write').where('order.order_id = :orderId', { orderId }).getOne();
      if (!order || order.payment_method !== 'cash') throw new ApiError('CASH_ORDER_NOT_FOUND', 'Cash order not found', HttpStatus.NOT_FOUND);
      if (order.assigned_rider_id !== riderId) throw new ApiError('ORDER_NOT_ASSIGNED', 'Order does not belong to this rider', HttpStatus.FORBIDDEN);
      const dispatch = await manager.findOne(OrderDispatch, { where: { order_id: orderId, assigned_rider_id: riderId } });
      if (!dispatch || dispatch.status !== 'delivered') throw new ApiError('ORDER_NOT_DELIVERED', 'Order is not delivered', HttpStatus.CONFLICT);

      const txnKey = `cash_commission_${order.id}`;
      const existing = await manager.findOne(WalletTransaction, { where: { idempotency_key: txnKey } });
      if (order.payment_status === 'cash_confirmed' && existing) return this.cashOrderPayload(order, existing.running_balance);
      if (order.payment_status !== 'collect_on_delivery') throw new ApiError('CASH_ALREADY_PROCESSED', 'Cash payment already processed', HttpStatus.CONFLICT);

      let wallet = await manager.createQueryBuilder(Wallet, 'wallet').setLock('pessimistic_write').where('wallet.user_id = :riderId AND wallet.user_type = :type', { riderId, type: 'rider' }).getOne();
      if (!wallet) {
        wallet = await manager.save(Wallet, {
          user_id: riderId,
          user_type: 'rider',
          currency_code: 'INR',
          cached_balance: 0,
          available_balance: 0,
          status: 'active',
        });
      }
      if (wallet.status !== 'active') throw new ApiError('WALLET_NOT_AVAILABLE', 'Rider wallet is not available', HttpStatus.CONFLICT);
      const commission = Number(order.platform_fee);
      const newBalance = Number(wallet.cached_balance) - commission;
      await manager.update(Wallet, wallet.id, { cached_balance: newBalance, available_balance: Math.max(0, Number(wallet.available_balance) - commission), version: wallet.version + 1 });
      await manager.save(WalletTransaction, { wallet_id: wallet.id, idempotency_key: txnKey, txn_type: 'debit', txn_category: 'purchase', amount: commission, running_balance: newBalance, description: `Platform commission — cash order ${order.order_id}`, reference_type: 'order', reference_id: order.order_id, status: 'completed', completed_at: new Date() });
      await manager.update(CustomerOrder, order.id, { payment_status: 'cash_confirmed' });
      order.payment_status = 'cash_confirmed';
      return this.cashOrderPayload(order, newBalance);
    });
  }

  private cashOrderPayload(order: CustomerOrder, newBalance: number) {
    return { order_id: order.order_id, cash_collected: Number(order.total_amount), display_cash_collected: money(Number(order.total_amount)), wallet_debit_amount: Number(order.platform_fee), display_wallet_debit: money(Number(order.platform_fee)), commission_amount: Number(order.platform_fee), display_commission: money(Number(order.platform_fee)), new_wallet_balance: newBalance, display_new_wallet_balance: money(newBalance), payment_status: 'cash_confirmed' };
  }

  // Get active cash trip for a rider
  async getActiveCashTrip(riderId: string) {
    const activeTrip = await this.tripPayments.findOne({
      where: {
        rider_id: riderId,
        payment_method: 'cash',
        status: 'pending'
      }
    });

    if (!activeTrip) {
      return null;
    }

    return {
      trip_id: activeTrip.trip_id,
      customer_name: 'Customer',
      payment_method: activeTrip.payment_method,
      original_fare: activeTrip.original_fare,
      discounted_fare: activeTrip.discounted_fare,
      discount_amount: activeTrip.discount_amount,
      display_collect: money(activeTrip.discounted_fare),
      display_original: money(activeTrip.original_fare),
      display_discount: `${money(activeTrip.discount_amount)} (coupon applied by customer)`,
      status: activeTrip.status,
      created_at: activeTrip.created_at
    };
  }

  // Confirm cash collection and deduct commission
  async confirmCashCollection(riderId: string, tripId: string, idempotencyKey: string) {
    if (!idempotencyKey) throw new ApiError('IDEMPOTENCY_REQUIRED', 'Idempotency key required', HttpStatus.BAD_REQUEST);

    return this.dataSource.transaction(async manager => {
      // Find trip payment
      const tripPayment = await manager.findOne(TripPayment, { where: { trip_id: tripId } });
      if (!tripPayment) throw new ApiError('TRIP_PAYMENT_NOT_FOUND', 'Trip payment not found', HttpStatus.NOT_FOUND);
      if (tripPayment.rider_id !== riderId) throw new ApiError('TRIP_NOT_FOUND', 'Trip not found for this rider', HttpStatus.FORBIDDEN);
      if (tripPayment.status !== 'pending') throw new ApiError('INVALID_TRIP_STATE', 'Trip is not in pending state', HttpStatus.UNPROCESSABLE_ENTITY);

      // Get wallet
      const wallet = await manager.findOne(Wallet, { where: { user_id: riderId, user_type: 'rider' } });
      if (!wallet) throw new ApiError('WALLET_NOT_FOUND', 'Wallet not found', HttpStatus.NOT_FOUND);

      // Update trip payment status
      await manager.update(TripPayment, tripPayment.id, {
        status: 'cash_collected',
        cash_collected_at: new Date()
      });

      // Record and deduct commission
      const commissionResult = await this.commissionEngine.deductCommission(tripPayment.id);

      // Get updated wallet
      const updatedWallet = await manager.findOne(Wallet, { where: { id: wallet.id } });
      const threshold = await this.getNegativeThreshold();
      const isBlocked = updatedWallet.cached_balance <= threshold;

      return {
        trip_id: tripPayment.trip_id,
        cash_collected: tripPayment.discounted_fare,
        display_collected: money(tripPayment.discounted_fare),
        commission_amount: commissionResult.commission_amount,
        commission_rate_percent: `${Math.round((commissionResult.commission_amount / tripPayment.original_fare) * 100)}%`,
        display_commission: money(commissionResult.commission_amount),
        commission_note: `Commission calculated on original fare (${money(tripPayment.original_fare)}), not discounted fare`,
        new_wallet_balance: commissionResult.new_balance,
        display_new_balance: money(commissionResult.new_balance),
        is_blocked: isBlocked,
        blocked_message: isBlocked ? `Your wallet is below ${money(threshold)}. Please top up to continue accepting rides.` : null,
        status: 'completed'
      };
    });
  }

  // Record cash trip for payment tracking
  async recordCashTrip(tripId: string, riderId: string, customerId: string, originalFare: number, discountedFare: number, discountAmount: number, idempotencyKey: string) {
    // Check idempotency
    const existing = await this.tripPayments.findOne({ where: { idempotency_key: idempotencyKey } });
    if (existing) {
      return { trip_payment_id: existing.id, status: existing.status };
    }

    const tripPayment = await this.tripPayments.save({
      trip_id: tripId,
      rider_id: riderId,
      customer_id: customerId,
      payment_method: 'cash',
      original_fare: originalFare,
      discounted_fare: discountedFare,
      discount_amount: discountAmount,
      status: 'pending',
      idempotency_key: idempotencyKey
    });

    return {
      trip_payment_id: tripPayment.id,
      status: tripPayment.status
    };
  }

  // Helper: Get negative balance threshold
  private async getNegativeThreshold(): Promise<number> {
    const rule = await this.rules.findOne({
      where: { rule_key: 'rider_negative_balance_threshold', is_active: true }
    });
    return rule ? parseInt(rule.rule_value) : -10000;
  }
}
