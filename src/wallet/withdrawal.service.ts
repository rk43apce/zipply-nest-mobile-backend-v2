import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiError } from '../common/api-error';
import { money } from '../common/utils';
import { Wallet, RiderWithdrawal, WalletTransaction, TopupLimitTracker, WalletAuditLog, BusinessRule } from '../entities';

@Injectable()
export class WithdrawalService {
  constructor(
    private dataSource: DataSource,
    @InjectRepository(Wallet) private wallets: Repository<Wallet>,
    @InjectRepository(RiderWithdrawal) private withdrawals: Repository<RiderWithdrawal>,
    @InjectRepository(WalletTransaction) private txns: Repository<WalletTransaction>,
    @InjectRepository(WalletAuditLog) private auditLogs: Repository<WalletAuditLog>,
    @InjectRepository(BusinessRule) private rules: Repository<BusinessRule>
  ) {}

  // Get withdrawal info and limits
  async getWithdrawInfo(riderId: string) {
    const wallet = await this.wallets.findOne({ where: { user_id: riderId, user_type: 'rider' } });
    if (!wallet) throw new ApiError('WALLET_NOT_FOUND', 'Wallet not found', HttpStatus.NOT_FOUND);

    const minWithdraw = await this.getRule('min_withdrawal_amount', 1000);
    const maxDailyWithdraw = await this.getRule('max_daily_withdrawal', 5000000);
    const coolingPeriod = await this.getRule('withdrawal_cooling_period_minutes', 30);

    // Check daily withdrawn
    const today = new Date().toISOString().slice(0, 10);
    const todayWithdrawals = await this.withdrawals.find({
      where: {
        rider_id: riderId,
        status: 'completed'
      }
    });
    const totalWithdrawnToday = todayWithdrawals
      .filter(w => w.completed_at && w.completed_at.toISOString().slice(0, 10) === today)
      .reduce((sum, w) => sum + w.amount, 0);

    const dailyRemaining = Math.max(0, maxDailyWithdraw - totalWithdrawnToday);
    const availableForWithdrawal = Math.min(wallet.cached_balance, dailyRemaining);

    return {
      available_for_withdrawal: Math.max(0, availableForWithdrawal),
      display_available: money(Math.max(0, availableForWithdrawal)),
      min_withdrawal: minWithdraw,
      max_daily_withdrawal: maxDailyWithdraw,
      daily_withdrawn_today: totalWithdrawnToday,
      daily_remaining: dailyRemaining,
      display_daily_remaining: money(dailyRemaining),
      cooling_period_active: false,
      payout_methods: [
        { type: 'upi', value: 'rider@upi', is_default: true },
        { type: 'bank_transfer', account_last4: '****', ifsc: 'SBIN0001234', is_default: false }
      ]
    };
  }

  // Initiate withdrawal
  async initiateWithdrawal(riderId: string, amount: number, payoutMethod: string, idempotencyKey: string) {
    if (amount <= 0) throw new ApiError('INVALID_AMOUNT', 'Amount must be positive', HttpStatus.BAD_REQUEST);
    if (!idempotencyKey) throw new ApiError('IDEMPOTENCY_REQUIRED', 'Idempotency key required', HttpStatus.BAD_REQUEST);

    const wallet = await this.wallets.findOne({ where: { user_id: riderId, user_type: 'rider' } });
    if (!wallet) throw new ApiError('WALLET_NOT_FOUND', 'Wallet not found', HttpStatus.NOT_FOUND);
    if (wallet.status === 'frozen') throw new ApiError('WALLET_FROZEN', 'Wallet is frozen', HttpStatus.FORBIDDEN);

    const minWithdraw = await this.getRule('min_withdrawal_amount', 1000);
    const maxDailyWithdraw = await this.getRule('max_daily_withdrawal', 5000000);

    if (amount < minWithdraw) {
      throw new ApiError('WITHDRAWAL_BELOW_MINIMUM', `Minimum withdrawal is ${money(minWithdraw)}`, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    if (wallet.cached_balance < amount) {
      throw new ApiError('INSUFFICIENT_BALANCE', `Cannot withdraw more than available balance (${money(wallet.cached_balance)})`, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    // Check idempotency
    const existing = await this.withdrawals.findOne({ where: { idempotency_key: idempotencyKey } });
    if (existing) return this.withdrawalResponse(existing, wallet);

    return this.dataSource.transaction(async manager => {
      // Debit wallet with optimistic locking
      const updateResult = await manager.update(
        Wallet,
        { id: wallet.id, version: wallet.version },
        { 
          cached_balance: wallet.cached_balance - amount,
          available_balance: wallet.available_balance - amount,
          version: wallet.version + 1
        }
      );

      if (updateResult.affected === 0) {
        throw new ApiError('OPTIMISTIC_LOCK_CONFLICT', 'Concurrent update detected, retry', HttpStatus.CONFLICT);
      }

      // Create transaction record
      const txn = await manager.save(WalletTransaction, {
        wallet_id: wallet.id,
        idempotency_key: `withdrawal_${idempotencyKey}`,
        txn_type: 'debit',
        txn_category: 'withdrawal',
        amount,
        running_balance: wallet.cached_balance - amount,
        description: `Withdrawal to ${payoutMethod}`,
        reference_type: 'withdrawal',
        status: 'completed',
        completed_at: new Date()
      });

      // Create withdrawal record
      const withdrawal = await manager.save(RiderWithdrawal, {
        rider_id: riderId,
        rider_wallet_id: wallet.id,
        amount,
        payout_method: payoutMethod,
        idempotency_key: idempotencyKey,
        wallet_txn_id: txn.id,
        status: 'processing'
      });

      // Audit log
      await manager.save(WalletAuditLog, {
        wallet_id: wallet.id,
        actor_type: 'user',
        action: 'withdrawal_initiated',
        entity_type: 'withdrawal',
        entity_id: withdrawal.id,
        old_state: { balance: wallet.cached_balance },
        new_state: { balance: wallet.cached_balance - amount }
      });

      const updatedWallet = await manager.findOne(Wallet, { where: { id: wallet.id } });
      return this.withdrawalResponse(withdrawal, updatedWallet);
    });
  }

  // Get withdrawal status
  async getWithdrawalStatus(riderId: string, withdrawalId: number) {
    const withdrawal = await this.withdrawals.findOne({ where: { id: withdrawalId } });
    if (!withdrawal || withdrawal.rider_id !== riderId) {
      throw new ApiError('WITHDRAWAL_NOT_FOUND', 'Withdrawal not found', HttpStatus.NOT_FOUND);
    }

    return {
      withdrawal_id: withdrawal.id,
      amount: withdrawal.amount,
      display_amount: money(withdrawal.amount),
      payout_method: withdrawal.payout_method,
      status: withdrawal.status,
      initiated_at: withdrawal.initiated_at,
      completed_at: withdrawal.completed_at,
      failed_at: withdrawal.failed_at,
      failure_reason: withdrawal.failure_reason
    };
  }

  // Mark withdrawal as completed (called by payout processor)
  async completeWithdrawal(withdrawalId: number) {
    const withdrawal = await this.withdrawals.findOne({ where: { id: withdrawalId } });
    if (!withdrawal) throw new ApiError('WITHDRAWAL_NOT_FOUND', 'Withdrawal not found', HttpStatus.NOT_FOUND);

    await this.withdrawals.update(withdrawalId, {
      status: 'completed',
      completed_at: new Date()
    });

    await this.auditLogs.save({
      wallet_id: withdrawal.rider_wallet_id,
      actor_type: 'system',
      action: 'withdrawal_completed',
      entity_type: 'withdrawal',
      entity_id: withdrawalId
    });

    return { status: 'completed' };
  }

  // Mark withdrawal as failed (called by payout processor)
  async failWithdrawal(withdrawalId: number, reason: string) {
    const withdrawal = await this.withdrawals.findOne({ where: { id: withdrawalId } });
    if (!withdrawal) throw new ApiError('WITHDRAWAL_NOT_FOUND', 'Withdrawal not found', HttpStatus.NOT_FOUND);

    return this.dataSource.transaction(async manager => {
      // Reverse the withdrawal - credit wallet back
      const wallet = await manager.findOne(Wallet, { where: { id: withdrawal.rider_wallet_id } });
      
      const updateResult = await manager.update(
        Wallet,
        { id: wallet.id, version: wallet.version },
        {
          cached_balance: wallet.cached_balance + withdrawal.amount,
          available_balance: wallet.available_balance + withdrawal.amount,
          version: wallet.version + 1
        }
      );

      if (updateResult.affected === 0) {
        throw new ApiError('OPTIMISTIC_LOCK_CONFLICT', 'Concurrent update detected', HttpStatus.CONFLICT);
      }

      // Create reversal transaction
      await manager.save(WalletTransaction, {
        wallet_id: wallet.id,
        idempotency_key: `reversal_withdrawal_${withdrawalId}_${Date.now()}`,
        txn_type: 'credit',
        txn_category: 'reversal',
        amount: withdrawal.amount,
        running_balance: wallet.cached_balance + withdrawal.amount,
        description: `Withdrawal reversal - ${reason}`,
        reference_type: 'withdrawal',
        reference_id: String(withdrawalId),
        status: 'completed',
        completed_at: new Date()
      });

      // Update withdrawal status
      await manager.update(RiderWithdrawal, withdrawalId, {
        status: 'failed',
        failure_reason: reason,
        failed_at: new Date()
      });

      // Audit log
      await manager.save(WalletAuditLog, {
        wallet_id: wallet.id,
        actor_type: 'system',
        action: 'withdrawal_failed',
        entity_type: 'withdrawal',
        entity_id: withdrawalId,
        old_state: { status: 'processing' },
        new_state: { status: 'failed', reason }
      });

      return { status: 'failed', reason };
    });
  }

  // Helper: Get business rule value
  private async getRule(key: string, defaultValue: number): Promise<number> {
    const rule = await this.rules.findOne({
      where: { rule_key: key, is_active: true }
    });
    return rule ? parseInt(rule.rule_value) : defaultValue;
  }

  // Response helper
  private withdrawalResponse(withdrawal: RiderWithdrawal, wallet: Wallet) {
    return {
      withdrawal_id: withdrawal.id,
      amount: withdrawal.amount,
      display_amount: money(withdrawal.amount),
      payout_method: withdrawal.payout_method,
      payout_to: withdrawal.payout_method === 'upi' ? 'rider@upi' : 'XXXX XXXX XXXX 0000',
      status: withdrawal.status,
      new_balance: wallet.cached_balance,
      display_new_balance: money(wallet.cached_balance),
      estimated_arrival: '2-4 hours'
    };
  }
}
