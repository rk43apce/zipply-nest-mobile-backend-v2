import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiError } from '../common/api-error';
import { money } from '../common/utils';
import { PaymentTransaction, TopupLimitTracker, Wallet, WalletHold, WalletTransaction } from '../entities';

@Injectable()
export class WalletService {
  constructor(
    private dataSource: DataSource,
    @InjectRepository(Wallet) private wallets: Repository<Wallet>,
    @InjectRepository(PaymentTransaction) private payments: Repository<PaymentTransaction>,
    @InjectRepository(WalletTransaction) private txns: Repository<WalletTransaction>,
    @InjectRepository(TopupLimitTracker) private limits: Repository<TopupLimitTracker>,
    @InjectRepository(WalletHold) private holds: Repository<WalletHold>
  ) {}

  async get(walletId: string) {
    const wallet = await this.mustWallet(walletId);
    return { wallet_id: wallet.id, customer_id: wallet.customer_id, cached_balance: wallet.cached_balance, available_balance: wallet.available_balance, display_balance: money(wallet.cached_balance), display_available: money(wallet.available_balance), status: wallet.status, daily_topup_limit: wallet.daily_topup_limit, monthly_topup_limit: wallet.monthly_topup_limit };
  }

  async getLimits(walletId: string) {
    const wallet = await this.mustWallet(walletId);
    const daily = await this.limitUsed(walletId, 'daily');
    const monthly = await this.limitUsed(walletId, 'monthly');
    return { daily: this.limitPayload(wallet.daily_topup_limit, daily), monthly: this.limitPayload(wallet.monthly_topup_limit, monthly) };
  }

  async initiateTopup(body: any) {
    const wallet = await this.mustWallet(body.wallet_id);
    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount <= 0) throw new ApiError('INVALID_AMOUNT', 'Invalid amount', HttpStatus.BAD_REQUEST);
    if (wallet.status !== 'active') throw new ApiError('WALLET_FROZEN', 'Wallet is not active', HttpStatus.FORBIDDEN);
    await this.checkTopupLimits(wallet, amount);
    if (!body.idempotency_key) throw new ApiError('IDEMPOTENCY_REQUIRED', 'Idempotency key is required', HttpStatus.BAD_REQUEST);
    const existing = await this.payments.findOneBy({ idempotency_key: body.idempotency_key });
    if (existing) return this.paymentInitiatedPayload(existing);
    const payment = await this.payments.save({
      wallet_id: wallet.id,
      amount,
      idempotency_key: body.idempotency_key,
      gateway_provider: body.gateway_provider || 'razorpay',
      gateway_order_id: `order_sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      expires_at: new Date(Date.now() + 3600000),
      metadata: { checkout_mode: 'simulation', requested_by: body.requested_by || 'customer_app' }
    });
    return this.paymentInitiatedPayload(payment);
  }

  async confirmTopup(paymentTxnId: string, body: any = {}) {
    const gatewayPaymentId = body.gateway_payment_id || `pay_sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return this.captureGatewayPayment(paymentTxnId, gatewayPaymentId, body.payment_method || 'razorpay_simulated');
  }

  async failTopup(paymentTxnId: string, body: any = {}) {
    return this.dataSource.transaction(async manager => {
      const payment = await manager.findOne(PaymentTransaction, { where: { id: paymentTxnId } });
      if (!payment) throw new ApiError('PAYMENT_NOT_FOUND', 'Payment transaction not found', HttpStatus.NOT_FOUND);
      if (payment.status === 'captured') throw new ApiError('PAYMENT_ALREADY_CAPTURED', 'Captured payments cannot be failed', HttpStatus.CONFLICT);
      if (payment.status === 'failed') return this.failedPayload(payment, body.reason || 'payment_failed');
      if (payment.status !== 'pending') throw new ApiError('PAYMENT_NOT_PENDING', 'Payment is not pending', HttpStatus.CONFLICT);
      await manager.update(PaymentTransaction, payment.id, {
        status: 'failed',
        gateway_payment_id: body.gateway_payment_id,
        payment_method: body.payment_method || 'razorpay_simulated',
        metadata: { ...(payment.metadata || {}), failure_reason: body.reason || 'payment_failed' }
      });
      payment.status = 'failed';
      return this.failedPayload(payment, body.reason || 'payment_failed');
    });
  }

  async handleRazorpayWebhook(body: any) {
    const paymentTxnId = body.payment_txn_id || body.notes?.payment_txn_id;
    if (!paymentTxnId) throw new ApiError('PAYMENT_TXN_REQUIRED', 'Payment transaction id is required', HttpStatus.BAD_REQUEST);
    const status = String(body.status || body.event || '').toLowerCase();
    if (['captured', 'success', 'payment.captured'].includes(status)) {
      if (!body.gateway_payment_id && !body.razorpay_payment_id) throw new ApiError('GATEWAY_PAYMENT_REQUIRED', 'Gateway payment id is required', HttpStatus.BAD_REQUEST);
      return this.confirmTopup(paymentTxnId, { gateway_payment_id: body.gateway_payment_id || body.razorpay_payment_id, payment_method: 'razorpay' });
    }
    return this.failTopup(paymentTxnId, { gateway_payment_id: body.gateway_payment_id || body.razorpay_payment_id, payment_method: 'razorpay', reason: body.reason || status || 'payment_failed' });
  }

  async payment(paymentTxnId: string) {
    const p = await this.payments.findOneBy({ id: paymentTxnId });
    if (!p) throw new ApiError('PAYMENT_NOT_FOUND', 'Payment transaction not found', HttpStatus.NOT_FOUND);
    return { payment_txn_id: p.id, amount: p.amount, status: p.status, gateway_provider: p.gateway_provider, gateway_order_id: p.gateway_order_id, gateway_payment_id: p.gateway_payment_id, payment_method: p.payment_method, captured_at: p.captured_at, expires_at: p.expires_at };
  }

  async transactions(walletId: string, page: number, limit: number, txnType?: string) {
    const safePage = Math.max(1, page || 1);
    const safeLimit = Math.min(Math.max(1, limit || 20), 100);
    const where: any = { wallet_id: walletId };
    if (txnType) where.txn_type = txnType;
    const [rows, total] = await this.txns.findAndCount({ where, order: { created_at: 'DESC' }, skip: (safePage - 1) * safeLimit, take: safeLimit });
    return { transactions: rows.map(t => ({ txn_id: t.id, txn_type: t.txn_type, txn_category: t.txn_category, amount: t.amount, display_amount: `${t.txn_type === 'credit' ? '+' : '-'}${money(t.amount)}`, description: t.description, reference_id: t.reference_id, created_at: t.created_at })), pagination: { page: safePage, limit: safeLimit, total, has_next: safePage * safeLimit < total } };
  }

  async placeHold(manager: any, walletId: string, amount: number, orderId: string) {
    const wallet = await manager.findOneByOrFail(Wallet, { id: walletId });
    if (wallet.status !== 'active') throw new ApiError('WALLET_FROZEN', 'Wallet is not active', HttpStatus.FORBIDDEN);
    if (wallet.available_balance < amount) throw new ApiError('INSUFFICIENT_BALANCE', `Wallet balance too low. Add ${money(amount - wallet.available_balance)} to continue`, HttpStatus.UNPROCESSABLE_ENTITY);
    const hold = await manager.save(WalletHold, { wallet_id: walletId, amount, reason: `Order ${orderId}`, reference_type: 'order', reference_id: orderId, idempotency_key: `order_hold_${orderId}`, expires_at: new Date(Date.now() + 24 * 3600000) });
    await manager.update(Wallet, walletId, { available_balance: wallet.available_balance - amount, version: wallet.version + 1 });
    return hold;
  }

  async captureHold(manager: any, holdId: string, orderId: string, amount: number) {
    const hold = await manager.findOneBy(WalletHold, { id: holdId });
    if (!hold || hold.status !== 'active') return;
    const wallet = await manager.findOneByOrFail(Wallet, { id: hold.wallet_id });
    const running = wallet.cached_balance - amount;
    const txn = await manager.save(WalletTransaction, { wallet_id: wallet.id, txn_type: 'debit', txn_category: 'hold_capture', amount, running_balance: running, description: `Order ${orderId}`, reference_type: 'order', reference_id: orderId });
    await manager.update(Wallet, wallet.id, { cached_balance: running, version: wallet.version + 1 });
    await manager.update(WalletHold, hold.id, { status: 'captured', capture_txn_id: txn.id, captured_at: new Date() });
  }

  async releaseHold(manager: any, holdId: string, orderId: string, fee = 0) {
    const hold = await manager.findOneBy(WalletHold, { id: holdId });
    if (!hold || hold.status !== 'active') return { refund: 0 };
    const wallet = await manager.findOneByOrFail(Wallet, { id: hold.wallet_id });
    const refund = hold.amount - fee;
    if (fee > 0) {
      await manager.save(WalletTransaction, { wallet_id: wallet.id, txn_type: 'debit', txn_category: 'cancellation_fee', amount: fee, running_balance: wallet.cached_balance - fee, description: `Cancellation fee: Order ${orderId}`, reference_type: 'order', reference_id: orderId });
      await manager.update(Wallet, wallet.id, { cached_balance: wallet.cached_balance - fee, available_balance: wallet.available_balance + refund, version: wallet.version + 1 });
    } else {
      await manager.update(Wallet, wallet.id, { available_balance: wallet.available_balance + refund, version: wallet.version + 1 });
    }
    await manager.update(WalletHold, hold.id, { status: 'released', released_at: new Date() });
    return { refund };
  }

  private async mustWallet(walletId: string) {
    const wallet = await this.wallets.findOneBy({ id: walletId });
    if (!wallet) throw new ApiError('WALLET_NOT_FOUND', 'Wallet not found', HttpStatus.NOT_FOUND);
    return wallet;
  }

  private async checkTopupLimits(wallet: Wallet, amount: number) {
    const daily = await this.limitUsed(wallet.id, 'daily');
    const monthly = await this.limitUsed(wallet.id, 'monthly');
    if (daily + amount > wallet.daily_topup_limit) throw new ApiError('DAILY_LIMIT_EXCEEDED', 'Daily top-up limit exceeded', HttpStatus.UNPROCESSABLE_ENTITY);
    if (monthly + amount > wallet.monthly_topup_limit) throw new ApiError('MONTHLY_LIMIT_EXCEEDED', 'Monthly top-up limit exceeded', HttpStatus.UNPROCESSABLE_ENTITY);
  }

  private async limitUsed(walletId: string, periodType: 'daily' | 'monthly') {
    const row = await this.limits.findOneBy({ wallet_id: walletId, period_type: periodType, period_start: this.periodStart(periodType) });
    return row?.amount_used || 0;
  }

  private async incrementLimit(manager: any, walletId: string, periodType: 'daily' | 'monthly', amount: number) {
    const period_start = this.periodStart(periodType);
    const row = await manager.findOneBy(TopupLimitTracker, { wallet_id: walletId, period_type: periodType, period_start });
    if (row) await manager.update(TopupLimitTracker, row.id, { amount_used: row.amount_used + amount });
    else await manager.insert(TopupLimitTracker, { wallet_id: walletId, period_type: periodType, period_start, amount_used: amount });
  }

  private periodStart(periodType: 'daily' | 'monthly') {
    const d = new Date();
    if (periodType === 'monthly') d.setDate(1);
    return d.toISOString().slice(0, 10);
  }

  private limitPayload(limit: number, used: number) {
    return { limit, used, remaining: Math.max(0, limit - used), display_limit: money(limit), display_used: money(used), display_remaining: money(Math.max(0, limit - used)) };
  }

  private paymentInitiatedPayload(p: PaymentTransaction) {
    return {
      payment_txn_id: p.id,
      amount: p.amount,
      status: p.status,
      gateway_provider: p.gateway_provider,
      gateway_order_id: p.gateway_order_id,
      gateway_checkout_data: {
        key: 'rzp_test_simulated',
        order_id: p.gateway_order_id,
        amount: p.amount,
        currency: 'INR',
        name: 'Vida',
        description: `Add ${money(p.amount)} to wallet`,
        callback_url: '/api/wallet/topup/webhook/razorpay',
        simulation: true
      },
      expires_at: p.expires_at
    };
  }

  private capturedPayload(payment: PaymentTransaction, wallet: Wallet) {
    return { payment_txn_id: payment.id, status: 'captured', gateway_payment_id: payment.gateway_payment_id, amount_credited: payment.amount, new_balance: wallet.cached_balance, display_new_balance: money(wallet.cached_balance) };
  }

  private failedPayload(payment: PaymentTransaction, reason: string) {
    return { payment_txn_id: payment.id, status: 'failed', amount_credited: 0, reason };
  }

  private async captureGatewayPayment(paymentTxnId: string, gatewayPaymentId: string, paymentMethod: string) {
    return this.dataSource.transaction(async manager => {
      const payment = await manager.findOne(PaymentTransaction, { where: { id: paymentTxnId } });
      if (!payment) throw new ApiError('PAYMENT_NOT_FOUND', 'Payment transaction not found', HttpStatus.NOT_FOUND);
      const wallet = await manager.findOneByOrFail(Wallet, { id: payment.wallet_id });
      if (payment.status === 'captured') return this.capturedPayload(payment, wallet);
      if (payment.status !== 'pending') throw new ApiError('PAYMENT_NOT_PENDING', 'Payment is not pending', HttpStatus.CONFLICT);
      if (payment.expires_at && payment.expires_at.getTime() < Date.now()) throw new ApiError('PAYMENT_EXPIRED', 'Payment order expired. Please initiate a new top-up.', HttpStatus.CONFLICT);
      const newBalance = wallet.cached_balance + payment.amount;
      await manager.update(PaymentTransaction, payment.id, { status: 'captured', gateway_payment_id: gatewayPaymentId, captured_at: new Date(), payment_method: paymentMethod });
      await manager.insert(WalletTransaction, { wallet_id: wallet.id, txn_type: 'credit', txn_category: 'topup', amount: payment.amount, running_balance: newBalance, description: `Top-up via ${payment.gateway_provider}`, reference_type: 'payment_transaction', reference_id: payment.id });
      await manager.update(Wallet, wallet.id, { cached_balance: newBalance, available_balance: wallet.available_balance + payment.amount, version: wallet.version + 1 });
      await this.incrementLimit(manager, wallet.id, 'daily', payment.amount);
      await this.incrementLimit(manager, wallet.id, 'monthly', payment.amount);
      payment.status = 'captured';
      payment.gateway_payment_id = gatewayPaymentId;
      return this.capturedPayload(payment, { ...wallet, cached_balance: newBalance, available_balance: wallet.available_balance + payment.amount } as Wallet);
    });
  }
}
