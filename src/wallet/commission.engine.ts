import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiError } from '../common/api-error';
import { CommissionLedger, TripPayment, Wallet, WalletTransaction, WalletAuditLog, BusinessRule } from '../entities';

@Injectable()
export class CommissionEngine {
  constructor(
    private dataSource: DataSource,
    @InjectRepository(CommissionLedger) private commissions: Repository<CommissionLedger>,
    @InjectRepository(TripPayment) private tripPayments: Repository<TripPayment>,
    @InjectRepository(Wallet) private wallets: Repository<Wallet>,
    @InjectRepository(WalletTransaction) private txns: Repository<WalletTransaction>,
    @InjectRepository(WalletAuditLog) private auditLogs: Repository<WalletAuditLog>,
    @InjectRepository(BusinessRule) private rules: Repository<BusinessRule>
  ) {}

  // Calculate commission for a trip
  async calculateCommission(tripPaymentId: number): Promise<{ commission_amount: number; commission_rate: number }> {
    const tripPayment = await this.tripPayments.findOne({ where: { id: tripPaymentId } });
    if (!tripPayment) throw new ApiError('TRIP_PAYMENT_NOT_FOUND', 'Trip payment not found', HttpStatus.NOT_FOUND);

    // Commission is always calculated on ORIGINAL fare, not discounted fare
    const commissionType = await this.getRule('commission_type', 'percentage');
    const commissionRate = await this.getRule('commission_rate', 2000); // in basis points

    let commissionAmount = 0;

    if (commissionType === 'percentage') {
      // Rate is in basis points (100 = 1%)
      commissionAmount = Math.round((tripPayment.original_fare * commissionRate) / 10000);
    } else if (commissionType === 'fixed') {
      commissionAmount = commissionRate;
    }

    return {
      commission_amount: commissionAmount,
      commission_rate: commissionRate
    };
  }

  // Record commission for a trip (called when cash is confirmed)
  async recordCommission(tripPaymentId: number, idempotencyKey: string) {
    // Check idempotency
    const existing = await this.commissions.findOne({
      where: { idempotency_key: idempotencyKey }
    });
    if (existing) {
      return {
        commission_id: existing.id,
        commission_amount: existing.commission_amount,
        status: existing.status
      };
    }

    return this.dataSource.transaction(async manager => {
      const tripPayment = await manager.findOne(TripPayment, { where: { id: tripPaymentId } });
      if (!tripPayment) throw new ApiError('TRIP_PAYMENT_NOT_FOUND', 'Trip payment not found', HttpStatus.NOT_FOUND);

      // Calculate commission
      const { commission_amount, commission_rate } = await this.calculateCommission(tripPaymentId);

      // Create commission ledger record
      const commission = await manager.save(CommissionLedger, {
        trip_payment_id: String(tripPaymentId),
        rider_id: tripPayment.rider_id,
        rider_wallet_id: tripPayment.rider_id, // Assuming wallet_id == rider_id for simplicity
        commission_amount,
        commission_type: 'percentage',
        commission_rate,
        fare_basis: tripPayment.original_fare,
        status: 'pending',
        idempotency_key: idempotencyKey
      } as any);

      return {
        commission_id: (commission as any).id,
        commission_amount,
        status: 'pending'
      };
    });
  }

  // Deduct commission from rider wallet (called after cash collection)
  async deductCommission(tripPaymentId: number) {
    return this.dataSource.transaction(async manager => {
      const tripPayment = await manager.findOne(TripPayment, { where: { id: tripPaymentId } });
      if (!tripPayment) throw new ApiError('TRIP_PAYMENT_NOT_FOUND', 'Trip payment not found', HttpStatus.NOT_FOUND);

      const commission = await manager.findOne(CommissionLedger, { where: { trip_payment_id: tripPaymentId as any } });
      if (!commission) throw new ApiError('COMMISSION_NOT_FOUND', 'Commission record not found', HttpStatus.NOT_FOUND);
      if (commission.status === 'deducted') {
        // Already deducted, return existing state
        return {
          commission_id: commission.id,
          commission_amount: commission.commission_amount,
          status: 'deducted'
        };
      }

      // Get rider wallet
      const wallet = await manager.findOne(Wallet, { where: { id: commission.rider_wallet_id as any } });
      if (!wallet) throw new ApiError('WALLET_NOT_FOUND', 'Wallet not found', HttpStatus.NOT_FOUND);

      // Debit wallet (commission is deducted from rider)
      const oldBalance = wallet.cached_balance;
      const newBalance = oldBalance - commission.commission_amount;

      const updateResult = await manager.update(
        Wallet,
        { id: wallet.id, version: wallet.version },
        {
          cached_balance: newBalance,
          available_balance: Math.max(0, wallet.available_balance - commission.commission_amount),
          version: wallet.version + 1
        }
      );

      if (updateResult.affected === 0) {
        throw new ApiError('OPTIMISTIC_LOCK_CONFLICT', 'Concurrent update detected, retry', HttpStatus.CONFLICT);
      }

      // Create debit transaction
      const txn = await manager.save(WalletTransaction, {
        wallet_id: wallet.id,
        idempotency_key: `commission_debit_${commission.id}_${Date.now()}`,
        txn_type: 'debit',
        txn_category: 'purchase',
        amount: commission.commission_amount,
        running_balance: newBalance,
        description: `Platform commission (${Math.round((commission.commission_rate / 10000) * 100)}%) — Trip #${tripPayment.trip_id}`,
        reference_type: 'trip',
        reference_id: String(tripPayment.trip_id),
        status: 'completed',
        completed_at: new Date()
      });

      // Update commission record
      await manager.update(CommissionLedger, commission.id, {
        status: 'deducted',
        wallet_txn_id: txn.id,
        deducted_at: new Date()
      });

      // Update trip payment
      await manager.update(TripPayment, tripPaymentId, {
        commission_amount: commission.commission_amount,
        commission_rate: commission.commission_rate,
        status: 'completed'
      });

      // Audit log
      await manager.save(WalletAuditLog, {
        wallet_id: wallet.id,
        actor_type: 'system',
        action: 'commission_deducted',
        entity_type: 'commission_ledger',
        entity_id: commission.id,
        old_state: { balance: oldBalance, commission: commission.commission_amount },
        new_state: { balance: newBalance, commission_deducted: true }
      });

      return {
        commission_id: commission.id,
        commission_amount: commission.commission_amount,
        new_balance: newBalance,
        status: 'deducted',
        trip_id: tripPayment.trip_id
      };
    });
  }

  // Helper: Get business rule value
  private async getRule(key: string, defaultValue: any): Promise<any> {
    const rule = await this.rules.findOne({
      where: { rule_key: key, is_active: true }
    });
    if (!rule) return defaultValue;
    
    if (rule.value_type === 'int') return parseInt(rule.rule_value);
    if (rule.value_type === 'boolean') return rule.rule_value.toLowerCase() === 'true';
    if (rule.value_type === 'json') return JSON.parse(rule.rule_value);
    return rule.rule_value;
  }
}
