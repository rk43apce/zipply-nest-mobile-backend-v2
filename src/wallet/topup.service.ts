import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiError } from '../common/api-error';
import { money } from '../common/utils';
import { PaymentTransaction, Wallet, WalletTransaction, TopupLimitTracker, TransactionLink, WalletAuditLog, BusinessRule } from '../entities';
import { RazorpayService } from './razorpay.service';

@Injectable()
export class TopUpService {
  private readonly logger = new Logger(TopUpService.name);

  constructor(
    private dataSource: DataSource,
    private razorpay: RazorpayService,
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

      // Create Razorpay order via service
      const receipt = `tp_${wallet.id.slice(0, 8)}_${Date.now()}`;
      const order = await this.razorpay.createOrder(amount, wallet.currency_code, receipt);
      
      const payment = await this.payments.save({
        wallet_id: wallet.id,
        idempotency_key: idempotencyKey,
        gateway_provider: gateway,
        gateway_order_id: order.id,
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
  async confirmTopUp(riderId: string, paymentTxnId: string, gatewayPaymentId: string, gatewaySignature: string, gatewayOrderId?: string) {
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

      // Security: Verify razorpay_order_id matches stored order
      if (gatewayOrderId && payment.gateway_order_id !== gatewayOrderId) {
        this.logger.warn(`[TOPUP_CONFIRM] Order ID mismatch: expected=${payment.gateway_order_id}, received=${gatewayOrderId}`);
        throw new ApiError('ORDER_MISMATCH', 'Razorpay order ID does not match', HttpStatus.BAD_REQUEST);
      }

      // Security: Check for duplicate gateway_payment_id (prevent replay attacks)
      const duplicatePayment = await manager.findOne(PaymentTransaction, {
        where: { gateway_payment_id: gatewayPaymentId }
      });
      if (duplicatePayment && duplicatePayment.id !== payment.id) {
        this.logger.warn(`[TOPUP_CONFIRM] Duplicate payment_id detected: ${gatewayPaymentId} already used in txn ${duplicatePayment.id}`);
        throw new ApiError('DUPLICATE_PAYMENT', 'This payment has already been processed', HttpStatus.CONFLICT);
      }

      // Verify Razorpay signature
      if (payment.gateway_provider === 'razorpay') {
        const isValid = this.razorpay.verifyPaymentSignature(payment.gateway_order_id, gatewayPaymentId, gatewaySignature);
        if (!isValid) {
          this.logger.warn(`[TOPUP_CONFIRM] Invalid signature for payment: ${paymentTxnId}, order: ${payment.gateway_order_id}`);
          throw new ApiError('INVALID_SIGNATURE', 'Invalid Razorpay signature', HttpStatus.BAD_REQUEST);
        }
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
      key_id: this.razorpay.getKeyId(),
      is_mock: this.razorpay.isMock(),
      prefill: {
        name: 'Rider',
        contact: '+91XXXXXXXXXX'
      },
      expires_at: payment.expires_at,
      // In mock mode, provide a test signature the client can use to confirm
      ...(this.razorpay.isMock() && {
        mock_payment_id: `pay_mock_${Date.now()}`,
        mock_signature: this.razorpay.generateSignature(payment.gateway_order_id, `pay_mock_${Date.now()}`)
      })
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

  // ==========================================================================
  // Customer Top-Up (same logic as rider, but user_type = 'customer')
  // ==========================================================================

  async initiateCustomerTopUp(customerId: string, amount: number, gateway: string = 'razorpay', idempotencyKey: string) {
    try {
      if (amount <= 0) throw new ApiError('INVALID_AMOUNT', 'Amount must be positive', HttpStatus.BAD_REQUEST);
      if (!idempotencyKey) throw new ApiError('IDEMPOTENCY_REQUIRED', 'Idempotency key required', HttpStatus.BAD_REQUEST);

      const wallet = await this.wallets.findOne({ where: { user_id: customerId as any, user_type: 'customer' } });
      if (!wallet) throw new ApiError('WALLET_NOT_FOUND', 'Wallet not found. Please contact support.', HttpStatus.NOT_FOUND);
      if (wallet.status === 'frozen') throw new ApiError('WALLET_FROZEN', 'Wallet is frozen', HttpStatus.FORBIDDEN);

      await this.checkTopupLimits(wallet, amount);

      const existing = await this.payments.findOne({ where: { idempotency_key: idempotencyKey } });
      if (existing) return this.paymentInitiatedResponse(existing);

      const receipt = `ctp_${wallet.id.slice(0, 8)}_${Date.now()}`;
      const order = await this.razorpay.createOrder(amount, wallet.currency_code, receipt);

      const payment = await this.payments.save({
        wallet_id: wallet.id,
        idempotency_key: idempotencyKey,
        gateway_provider: gateway,
        gateway_order_id: order.id,
        amount,
        currency_code: wallet.currency_code,
        status: 'pending',
        expires_at: new Date(Date.now() + 3600000)
      } as any);

      return this.paymentInitiatedResponse(payment);
    } catch (error) {
      this.logger.error('[CUSTOMER_TOPUP_INITIATE_ERROR]', { customerId, amount, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  async confirmCustomerTopUp(customerId: string, paymentTxnId: string, gatewayPaymentId: string, gatewaySignature: string, gatewayOrderId?: string) {
    return this.dataSource.transaction(async manager => {
      const payment = await manager.findOne(PaymentTransaction, { where: { id: paymentTxnId } });
      if (!payment) throw new ApiError('PAYMENT_NOT_FOUND', 'Payment not found', HttpStatus.NOT_FOUND);

      const wallet = await manager.findOne(Wallet, { where: { id: payment.wallet_id } });
      if (!wallet) throw new ApiError('WALLET_NOT_FOUND', 'Wallet not found', HttpStatus.NOT_FOUND);
      if (wallet.user_id !== (customerId as any)) throw new ApiError('WALLET_MISMATCH', 'Wallet does not belong to customer', HttpStatus.FORBIDDEN);

      if (payment.status === 'captured') {
        const newWallet = await manager.findOne(Wallet, { where: { id: wallet.id } });
        return this.paymentConfirmedResponse(payment, newWallet!);
      }
      if (payment.status !== 'pending') throw new ApiError('PAYMENT_INVALID_STATE', `Cannot confirm payment in status: ${payment.status}`, HttpStatus.CONFLICT);
      if (payment.expires_at && payment.expires_at < new Date()) throw new ApiError('PAYMENT_EXPIRED', 'Payment order expired', HttpStatus.CONFLICT);

      if (gatewayOrderId && payment.gateway_order_id !== gatewayOrderId) {
        throw new ApiError('ORDER_MISMATCH', 'Razorpay order ID does not match', HttpStatus.BAD_REQUEST);
      }

      const duplicatePayment = await manager.findOne(PaymentTransaction, { where: { gateway_payment_id: gatewayPaymentId } });
      if (duplicatePayment && duplicatePayment.id !== payment.id) {
        throw new ApiError('DUPLICATE_PAYMENT', 'This payment has already been processed', HttpStatus.CONFLICT);
      }

      if (payment.gateway_provider === 'razorpay') {
        const isValid = this.razorpay.verifyPaymentSignature(payment.gateway_order_id, gatewayPaymentId, gatewaySignature);
        if (!isValid) throw new ApiError('INVALID_SIGNATURE', 'Invalid Razorpay signature', HttpStatus.BAD_REQUEST);
      }

      const oldBalance = wallet.cached_balance;
      const newBalance = oldBalance + payment.amount;

      const updateResult = await manager.update(
        Wallet,
        { id: wallet.id, version: wallet.version },
        { cached_balance: newBalance, available_balance: wallet.available_balance + payment.amount, version: wallet.version + 1 }
      );
      if (updateResult.affected === 0) throw new ApiError('OPTIMISTIC_LOCK_CONFLICT', 'Concurrent update detected, retry', HttpStatus.CONFLICT);

      const txn = await manager.save(WalletTransaction, {
        wallet_id: wallet.id,
        idempotency_key: `customer_topup_${paymentTxnId}_${Date.now()}`,
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

      await manager.save(TransactionLink, { payment_txn_id: payment.id, wallet_txn_id: txn.id });

      payment.status = 'captured';
      payment.gateway_payment_id = gatewayPaymentId;
      payment.metadata = { ...payment.metadata, gateway_signature: gatewaySignature };
      payment.captured_at = new Date();
      await manager.save(payment);

      await this.incrementLimits(manager, wallet.id as any, payment.amount);

      await manager.save(WalletAuditLog, {
        wallet_id: wallet.id,
        actor_type: 'customer',
        action: 'topup_confirmed',
        entity_type: 'payment_transaction',
        entity_id: 0,
        old_state: { balance: oldBalance },
        new_state: { balance: newBalance }
      } as any);

      const finalWallet = await manager.findOne(Wallet, { where: { id: wallet.id } });
      return this.paymentConfirmedResponse(payment, finalWallet!);
    });
  }
}
