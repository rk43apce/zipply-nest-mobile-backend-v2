import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiError } from '../common/api-error';
import { money } from '../common/utils';
import { TripPayment, Wallet, BusinessRule } from '../entities';
import { CommissionEngine } from './commission.engine';

@Injectable()
export class CashPaymentService {
  constructor(
    private dataSource: DataSource,
    @InjectRepository(TripPayment) private tripPayments: Repository<TripPayment>,
    @InjectRepository(Wallet) private wallets: Repository<Wallet>,
    @InjectRepository(BusinessRule) private rules: Repository<BusinessRule>,
    private commissionEngine: CommissionEngine
  ) {}

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
