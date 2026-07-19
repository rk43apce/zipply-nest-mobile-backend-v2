import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiError } from '../common/api-error';
import { money } from '../common/utils';
import { 
  Wallet, WalletTransaction, PaymentTransaction, WalletHold, TopupLimitTracker,
  WalletAuditLog, CommissionLedger, TripPayment, BusinessRule
} from '../entities';

@Injectable()
export class WalletService {
  private readonly MAX_RETRIES = 3;
  
  constructor(
    private dataSource: DataSource,
    @InjectRepository(Wallet) private wallets: Repository<Wallet>,
    @InjectRepository(WalletTransaction) private txns: Repository<WalletTransaction>,
    @InjectRepository(PaymentTransaction) private payments: Repository<PaymentTransaction>,
    @InjectRepository(WalletHold) private holds: Repository<WalletHold>,
    @InjectRepository(TopupLimitTracker) private limits: Repository<TopupLimitTracker>,
    @InjectRepository(WalletAuditLog) private auditLogs: Repository<WalletAuditLog>,
    @InjectRepository(BusinessRule) private rules: Repository<BusinessRule>
  ) {}

  // Get wallet balance and status for customer
  async getCustomerWallet(customerId: string) {
    try {
      let wallet = await this.wallets.findOne({ where: { user_id: customerId, user_type: 'customer' } });
      if (!wallet) {
        console.log(`[WALLET] Creating new wallet for customer ${customerId}`);
        // Auto-create wallet on first access
        wallet = await this.wallets.save({
          user_id: customerId,
          user_type: 'customer',
          currency_code: 'INR',
          cached_balance: 0,
          available_balance: 0,
          status: 'active'
        });
        console.log(`[WALLET] Created wallet ID: ${wallet.id}`);
      }
      
      return {
        wallet_id: wallet.id,
        customer_id: customerId,
        cached_balance: wallet.cached_balance,
        available_balance: wallet.available_balance,
        display_balance: money(wallet.cached_balance),
        display_available: money(wallet.available_balance),
        currency: wallet.currency_code,
        status: wallet.status
      };
    } catch (error) {
      console.error('[WALLET_ERROR] getCustomerWallet failed:', error);
      throw error;
    }
  }

  // Get wallet balance and status
  async getWallet(riderId: string) {
    try {
      let wallet = await this.wallets.findOne({ where: { user_id: riderId, user_type: 'rider' } });
      if (!wallet) {
        console.log(`[WALLET] Creating new wallet for rider ${riderId}`);
        // Auto-create wallet on first access
        wallet = await this.wallets.save({
          user_id: riderId,
          user_type: 'rider',
          currency_code: 'INR',
          cached_balance: 0,
          available_balance: 0,
          status: 'active'
        });
        console.log(`[WALLET] Created wallet ID: ${wallet.id}`);
      }
      const isBlocked = wallet.cached_balance <= await this.getNegativeThreshold();
      
      return {
        wallet_id: wallet.id,
        rider_id: riderId,
        wallet_balance: wallet.cached_balance,
        cached_balance: wallet.cached_balance,
        available_balance: wallet.available_balance,
        display_wallet_balance: money(wallet.cached_balance),
        display_balance: money(wallet.cached_balance),
        display_available: money(wallet.available_balance),
        currency: wallet.currency_code,
        status: wallet.status,
        is_blocked: isBlocked,
        blocked_reason: isBlocked ? `Balance below threshold (${money(await this.getNegativeThreshold())}). Top up to accept rides.` : null,
        negative_threshold: await this.getNegativeThreshold(),
        display_threshold: money(await this.getNegativeThreshold())
      };
    } catch (error) {
      console.error('[WALLET_ERROR] getWallet failed:', error);
      throw error;
    }
  }

  // Create wallet for new user (rider or customer)
  async createWallet(userId: string, userType: string = 'rider', currencyCode = 'INR') {
    const existing = await this.wallets.findOne({ where: { user_id: userId, user_type: userType } });
    if (existing) return existing;

    const wallet = await this.wallets.save({
      user_id: userId,
      user_type: userType,
      currency_code: currencyCode,
      cached_balance: 0,
      available_balance: 0,
      status: 'active',
      kyc_level: 'basic',
      version: 1
    });

    await this.logAudit(wallet.id, 'system', 'wallet_created', 'wallet', 0, null, { id: wallet.id, user_id: userId, user_type: userType });
    return wallet;
  }

  // Credit wallet with optimistic locking
  async creditWallet(walletId: string, amount: number, txnCategory: string, idempotencyKey: string, description?: string, referenceType?: string, referenceId?: string) {
    if (amount <= 0) throw new ApiError('INVALID_AMOUNT', 'Amount must be positive', HttpStatus.BAD_REQUEST);

    // Check idempotency
    const existing = await this.txns.findOne({ where: { idempotency_key: idempotencyKey } });
    if (existing) return { txn_id: existing.id, new_balance: existing.running_balance };

    return this.dataSource.transaction(async manager => {
      let wallet = await manager.findOne(Wallet, { where: { id: walletId } });
      if (!wallet) throw new ApiError('WALLET_NOT_FOUND', 'Wallet not found', HttpStatus.NOT_FOUND);
      if (wallet.status === 'frozen') throw new ApiError('WALLET_FROZEN', 'Wallet is frozen', HttpStatus.FORBIDDEN);

      const oldBalance = wallet.cached_balance;
      const newBalance = oldBalance + amount;

      // Optimistic locking: update with version check
      const result = await manager.update(
        Wallet,
        { id: walletId, version: wallet.version },
        { cached_balance: newBalance, available_balance: wallet.available_balance + amount, version: wallet.version + 1 }
      );

      if (result.affected === 0) throw new ApiError('OPTIMISTIC_LOCK_CONFLICT', 'Concurrent update detected, retry', HttpStatus.CONFLICT);

      // Create transaction record
      const txn = await manager.save(WalletTransaction, {
        wallet_id: walletId,
        idempotency_key: idempotencyKey,
        txn_type: 'credit',
        txn_category: txnCategory,
        amount,
        running_balance: newBalance,
        description,
        reference_type: referenceType,
        reference_id: referenceId,
        status: 'completed',
        completed_at: new Date()
      } as any);

      await this.logAudit(walletId, 'system', 'credit', 'wallet_transaction', 0, { balance: oldBalance }, { balance: newBalance });

      return { txn_id: txn.id, new_balance: newBalance };
    });
  }

  // Debit wallet with optimistic locking
  async debitWallet(walletId: string, amount: number, txnCategory: string, idempotencyKey: string, description?: string, referenceType?: string, referenceId?: string) {
    if (amount <= 0) throw new ApiError('INVALID_AMOUNT', 'Amount must be positive', HttpStatus.BAD_REQUEST);

    // Check idempotency
    const existing = await this.txns.findOne({ where: { idempotency_key: idempotencyKey } });
    if (existing) return { txn_id: existing.id, new_balance: existing.running_balance };

    return this.dataSource.transaction(async manager => {
      let wallet = await manager.findOne(Wallet, { where: { id: walletId } });
      if (!wallet) throw new ApiError('WALLET_NOT_FOUND', 'Wallet not found', HttpStatus.NOT_FOUND);
      if (wallet.status === 'frozen') throw new ApiError('WALLET_FROZEN', 'Wallet is frozen', HttpStatus.FORBIDDEN);

      const oldBalance = wallet.cached_balance;
      const newBalance = oldBalance - amount;

      // Optimistic locking: update with version check
      const result = await manager.update(
        Wallet,
        { id: walletId, version: wallet.version },
        { cached_balance: newBalance, available_balance: Math.max(0, wallet.available_balance - amount), version: wallet.version + 1 }
      );

      if (result.affected === 0) throw new ApiError('OPTIMISTIC_LOCK_CONFLICT', 'Concurrent update detected, retry', HttpStatus.CONFLICT);

      // Create transaction record
      const txn = await manager.save(WalletTransaction, {
        wallet_id: walletId,
        idempotency_key: idempotencyKey,
        txn_type: 'debit',
        txn_category: txnCategory,
        amount,
        running_balance: newBalance,
        description,
        reference_type: referenceType,
        reference_id: referenceId,
        status: 'completed',
        completed_at: new Date()
      } as any);

      await this.logAudit(walletId, 'system', 'debit', 'wallet_transaction', 0, { balance: oldBalance }, { balance: newBalance });

      return { txn_id: txn.id, new_balance: newBalance };
    });
  }

  // Get wallet transactions history
  async getTransactions(riderId: string, page: number = 1, perPage: number = 20, txnType?: string) {
    const wallet = await this.findWalletByUser(riderId, 'rider');
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, perPage), 100);

    const where: any = { wallet_id: wallet.id };
    if (txnType) where.txn_type = txnType;

    const [txns, total] = await this.txns.findAndCount({
      where,
      order: { created_at: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit
    });

    return {
      transactions: txns.map(t => ({
        txn_id: t.id,
        txn_type: t.txn_type,
        txn_category: t.txn_category,
        amount: t.amount,
        display_amount: `${t.txn_type === 'credit' ? '+' : '-'}${money(t.amount)}`,
        running_balance: t.running_balance,
        description: t.description,
        reference_type: t.reference_type,
        reference_id: t.reference_id,
        status: t.status,
        created_at: t.created_at
      })),
      pagination: {
        page: safePage,
        per_page: safeLimit,
        total,
        total_pages: Math.ceil(total / safeLimit)
      }
    };
  }

  // Check if rider is eligible to accept rides
  async checkRiderEligibility(riderId: string) {
    const wallet = await this.findWalletByUser(riderId, 'rider');
    const threshold = await this.getNegativeThreshold();
    const isBlocked = wallet.cached_balance <= threshold;

    return {
      can_accept_rides: !isBlocked,
      wallet_balance: wallet.cached_balance,
      is_blocked: isBlocked,
      blocked_reason: isBlocked ? `Wallet balance below threshold (${money(threshold)})` : null,
      ...(isBlocked && {
        action_required: 'topup',
        minimum_topup_needed: Math.max(0, threshold - wallet.cached_balance + 100),
        display_minimum: money(Math.max(0, threshold - wallet.cached_balance + 100))
      })
    };
  }

  // Admin freeze wallet
  async freezeWallet(walletId: string, reason?: string) {
    await this.wallets.update(walletId, { status: 'frozen' });
    await this.logAudit(walletId, 'admin', 'wallet_frozen', 'wallet', 0, { status: 'active' }, { status: 'frozen', reason });
    return { status: 'frozen' };
  }

  // Admin unfreeze wallet
  async unfreezeWallet(walletId: string) {
    await this.wallets.update(walletId, { status: 'active' });
    await this.logAudit(walletId, 'admin', 'wallet_unfrozen', 'wallet', 0, { status: 'frozen' }, { status: 'active' });
    return { status: 'active' };
  }

  // Helper: Find wallet by user ID and type
  private async findWalletByUser(userId: string, userType: string) {
    const wallet = await this.wallets.findOne({ where: { user_id: userId, user_type: userType } });
    if (!wallet) throw new ApiError('WALLET_NOT_FOUND', 'Wallet not found', HttpStatus.NOT_FOUND);
    return wallet;
  }

  // Helper: Get negative balance threshold from business rules
  private async getNegativeThreshold(): Promise<number> {
    const rule = await this.rules.findOne({
      where: { rule_key: 'rider_negative_balance_threshold', is_active: true }
    });
    return rule ? parseInt(rule.rule_value) : -10000;
  }

  // Helper: Log audit trail
  private async logAudit(walletId: string, actorType: string, action: string, entityType: string, entityId: number, oldState?: any, newState?: any) {
    await this.auditLogs.save({
      wallet_id: walletId,
      actor_type: actorType,
      action,
      entity_type: entityType,
      entity_id: entityId,
      old_state: oldState,
      new_state: newState
    } as any);
  }
}
