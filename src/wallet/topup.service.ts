import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ApiError } from '../common/api-error';
import { money } from '../common/utils';
import { PaymentTransaction, Wallet, WalletTransaction, TopupLimitTracker, TransactionLink, WalletAuditLog, BusinessRule } from '../entities';

@Injectable()
export class TopUpService {
  constructor(
    private dataSource: DataSource,
    @InjectRepository(PaymentTransaction) private payments: Repository<PaymentTransaction>,
    @InjectRepository(Wallet) private wallets: Repository<Wallet>,
    @InjectRepository(WalletTransaction) private txns: Repository<WalletTransaction>,
    @InjectRepository(TopupLimitTracker) private limits: Repository<TopupLimitTracker>,
    @InjectRepository(TransactionLink) private links: Repository<TransactionLink>,
    @InjectRepository(WalletAuditLog) private auditLogs: Repository<WalletAuditLog>,
    @InjectRepository(BusinessRule) private rules: Repository<BusinessRule>
  ) {}

  // Initiate top-up: create payment order
  async initiateTopUp(riderId: string, amount: number, gateway: string = 'razorpay', idempotencyKey: string) {
    try {
      if (amount <= 0) throw new ApiError('INVALID_AMOUNT', 'Amount must be positive', HttpStatus.BAD_REQUEST);
      if (!idempotencyKey) throw new ApiError('IDEMPOTENCY_REQUIRED', 'Idempotency key required', HttpStatus.BAD_REQUEST);

      const wallet = await this.wallets.findOne({ where: { user_id: riderId as any, user_type: 'rider' } });
      if (!wallet) throw new ApiError('WALLET_NOT_FOUND', 'Wallet not found', HttpStatus.NOT_FOUND);
      if (wallet.status === 'frozen') throw new ApiError('WALLET_FROZEN', 'Wallet is frozen', HttpStatus.FORBIDDEN);

      // Check topup limits
      await this.checkTopupLimits(wallet, amount);

      // Check idempotency
      const existing = await this.payments.findOne({ where: { idempotency_key: idempotencyKey } });
      if (existing) return this.paymentInitiatedResponse(existing);

      // Create payment transaction
      const razorpayOrderId = `order_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const payment = await this.payments.save({
        wallet_id: wallet.id,
        idempotency_key: idempotencyKey,
        gateway_provider: gateway,
        gateway_order_id: razorpayOrderId,
        amount,
        currency_code: wallet.currency_code,
        status: 'pending',
        expires_at: new Date(Date.now() + 3600000) // 1 hour expiry
      } as any);

      return this.paymentInitiatedResponse(payment);
    } catch (error) {
      console.error('[TOPUP_INITIATE_ERROR]', {
        riderId,
        amount,
        gateway,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  // Confirm top-up: verify signature and credit wallet
  async confirmTopUp(riderId: string, paymentTxnId: string, gatewayPaymentId: string, gatewaySignature: string) {
    return this.dataSource.transaction(async manager => {
      const payment = await manager.findOne(PaymentTransaction, { where: { id: paymentTxnId } });
      if (!payment) throw new ApiError('PAYMENT_NOT_FOUND', 'Payment not found', HttpStatus.NOT_FOUND);

      const wallet = await manager.findOne(Wallet, { where: { id: payment.wallet_id } });
      if (!wallet) throw new ApiError('WALLET_NOT_FOUND', 'Wallet not found', HttpStatus.NOT_FOUND);
      if (wallet.user_id !== (riderId as any)) throw new ApiError('WALLET_MISMATCH', 'Wallet does not belong to rider', HttpStatus.FORBIDDEN);

      if (payment.status === 'captured') {
        const newWallet = await manager.findOne(Wallet, { where: { id: wallet.id } });
        return this.paymentConfirmedResponse(payment, newWallet);
      }

      if (payment.status !== 'pending') {
        throw new ApiError('PAYMENT_INVALID_STATE', `Cannot confirm payment in status: ${payment.status}`, HttpStatus.CONFLICT);
      }

      if (payment.expires_at && payment.expires_at < new Date()) {
        throw new ApiError('PAYMENT_EXPIRED', 'Payment order expired', HttpStatus.CONFLICT);
      }

      // Verify Razorpay signature (in production)
      if (payment.gateway_provider === 'razorpay') {
        this.verifyRazorpaySignature(payment.gateway_order_id, gatewayPaymentId, gatewaySignature);
      }

      // Credit wallet with optimistic locking
      const oldBalance = wallet.cached_balance;
      const newBalance = oldBalance + payment.amount;

      const updateResult = await manager.update(
        Wallet,
        { id: wallet.id, version: wallet.version },
        { 
          cached_balance: newBalance, 
          available_balance: wallet.available_balance + payment.amount,
          version: wallet.version + 1 
        }
      );

      if (updateResult.affected === 0) {
        throw new ApiError('OPTIMISTIC_LOCK_CONFLICT', 'Concurrent update detected, retry', HttpStatus.CONFLICT);
      }

      // Create wallet transaction
      const txn = await manager.save(WalletTransaction, {
        wallet_id: wallet.id,
        idempotency_key: `topup_${paymentTxnId}_${Date.now()}`,
        txn_type: 'credit',
        txn_category: 'topup',
        amount: payment.amount,
        running_balance: newBalance,
        description: `Top-up via ${payment.gateway_provider}`,
        reference_type: 'payment_transaction',
        reference_id: String(payment.id),
        status: 'completed',
        completed_at: new Date()
      });

      // Link payment transaction to wallet transaction
      await manager.save(TransactionLink, {
        payment_txn_id: payment.id,
        wallet_txn_id: txn.id
      });

      // Update payment transaction
      payment.status = 'captured';
      payment.gateway_payment_id = gatewayPaymentId;
      payment.metadata = { ...payment.metadata, gateway_signature: gatewaySignature };
      payment.captured_at = new Date();
      await manager.save(payment);

      // Update topup limits
      await this.incrementLimits(manager, (wallet.id as any as string), payment.amount);

      // Audit log
      await manager.save(WalletAuditLog, {
        wallet_id: wallet.id,
        actor_type: 'gateway_webhook',
        action: 'topup_confirmed',
        entity_type: 'payment_transaction',
        entity_id: 0,
        old_state: { balance: oldBalance },
        new_state: { balance: newBalance }
      } as any);

      const finalWallet = await manager.findOne(Wallet, { where: { id: wallet.id } });
      return this.paymentConfirmedResponse(payment, finalWallet);
    });
  }

  // Verify Razorpay signature
  private verifyRazorpaySignature(orderId: string, paymentId: string, signature: string) {
    const secret = process.env.RAZORPAY_KEY_SECRET || 'test_secret';
    const payload = `${orderId}|${paymentId}`;
    const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    
    if (signature !== expectedSignature) {
      throw new ApiError('INVALID_SIGNATURE', 'Invalid Razorpay signature', HttpStatus.BAD_REQUEST);
    }
  }

  // Check topup limits
  private async checkTopupLimits(wallet: Wallet, amount: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dailyUsed = await this.limits.findOne({ 
      where: { wallet_id: wallet.id as any, period_type: 'daily', period_start: today as any }
    });
    const dailyTotal = (dailyUsed?.amount_used || 0) + amount;

    const monthlyUsed = await this.limits.findOne({
      where: { wallet_id: wallet.id as any, period_type: 'monthly' }
    });
    const monthlyTotal = (monthlyUsed?.amount_used || 0) + amount;

    if (dailyTotal > wallet.daily_topup_limit) {
      throw new ApiError('DAILY_LIMIT_EXCEEDED', `Daily top-up limit exceeded`, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (monthlyTotal > wallet.monthly_topup_limit) {
      throw new ApiError('MONTHLY_LIMIT_EXCEEDED', `Monthly top-up limit exceeded`, HttpStatus.UNPROCESSABLE_ENTITY);
    }
  }

  // Increment topup limits
  private async incrementLimits(manager: any, walletId: string, amount: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let dailyUsed = await manager.findOne(TopupLimitTracker, {
      where: { wallet_id: walletId as any, period_type: 'daily', period_start: today as any }
    });
    if (dailyUsed) {
      dailyUsed.amount_used += amount;
      await manager.save(dailyUsed);
    } else {
      await manager.save(TopupLimitTracker, {
        wallet_id: walletId,
        period_type: 'daily',
        period_start: today,
        amount_used: amount
      });
    }

    const monthlyDate = new Date();
    monthlyDate.setDate(1);
    monthlyDate.setHours(0, 0, 0, 0);

    let monthlyUsed = await manager.findOne(TopupLimitTracker, {
      where: { wallet_id: walletId as any, period_type: 'monthly', period_start: monthlyDate as any }
    });
    if (monthlyUsed) {
      monthlyUsed.amount_used += amount;
      await manager.save(monthlyUsed);
    } else {
      await manager.save(TopupLimitTracker, {
        wallet_id: walletId,
        period_type: 'monthly',
        period_start: monthlyDate,
        amount_used: amount
      });
    }
  }

  // Response helpers
  private paymentInitiatedResponse(payment: PaymentTransaction) {
    return {
      payment_txn_id: payment.id,
      gateway_order_id: payment.gateway_order_id,
      amount: payment.amount,
      currency: payment.currency_code,
      gateway: payment.gateway_provider,
      key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_simulated',
      prefill: {
        name: 'Rider',
        contact: '+91XXXXXXXXXX'
      },
      expires_at: payment.expires_at
    };
  }

  private paymentConfirmedResponse(payment: PaymentTransaction, wallet: Wallet) {
    return {
      wallet_txn_id: `txn_${payment.id}`,
      credited_amount: payment.amount,
      new_balance: wallet.cached_balance,
      display_new_balance: money(wallet.cached_balance),
      is_blocked: wallet.cached_balance <= -10000,
      was_unblocked: payment.amount > 0 && wallet.cached_balance > -10000
    };
  }
}
