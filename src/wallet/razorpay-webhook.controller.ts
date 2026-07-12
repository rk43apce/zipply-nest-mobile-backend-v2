import { Body, Controller, Post, Headers, HttpCode, Logger, RawBodyRequest, Req } from '@nestjs/common';
import { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PaymentTransaction, Wallet, WalletTransaction, TopupLimitTracker, TransactionLink, WalletAuditLog } from '../entities';
import { RazorpayService, RazorpayPaymentEvent } from './razorpay.service';
import { money } from '../common/utils';

@Controller('webhooks/razorpay')
export class RazorpayWebhookController {
  private readonly logger = new Logger(RazorpayWebhookController.name);

  constructor(
    private dataSource: DataSource,
    private razorpay: RazorpayService,
    @InjectRepository(PaymentTransaction) private payments: Repository<PaymentTransaction>,
    @InjectRepository(Wallet) private wallets: Repository<Wallet>,
    @InjectRepository(WalletTransaction) private txns: Repository<WalletTransaction>,
    @InjectRepository(TopupLimitTracker) private limits: Repository<TopupLimitTracker>,
    @InjectRepository(TransactionLink) private links: Repository<TransactionLink>,
    @InjectRepository(WalletAuditLog) private auditLogs: Repository<WalletAuditLog>,
  ) {}

  /**
   * Razorpay Webhook Handler
   * Handles async payment events from Razorpay:
   * - payment.captured: Payment was successfully captured
   * - payment.failed: Payment failed
   * - refund.created: Refund was initiated
   * 
   * This is the authoritative source of truth for payment status.
   * Even if the client-side confirm call succeeds, the webhook ensures
   * we don't miss any payment state changes.
   */
  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Body() body: any,
    @Headers('x-razorpay-signature') signature: string,
    @Req() req: Request,
  ) {
    const rawBody = JSON.stringify(body);

    // Verify webhook signature
    if (!this.razorpay.verifyWebhookSignature(rawBody, signature || '')) {
      this.logger.warn('[WEBHOOK] Invalid signature received, ignoring');
      // Return 200 anyway to prevent Razorpay from retrying (security best practice)
      return { status: 'ignored', reason: 'invalid_signature' };
    }

    const event = body.event as string;
    this.logger.log(`[WEBHOOK] Received event: ${event}`);

    switch (event) {
      case 'payment.captured':
        return this.handlePaymentCaptured(body);
      case 'payment.failed':
        return this.handlePaymentFailed(body);
      case 'refund.created':
        return this.handleRefundCreated(body);
      default:
        this.logger.log(`[WEBHOOK] Unhandled event type: ${event}`);
        return { status: 'ignored', event };
    }
  }

  /**
   * Handle payment.captured event
   * Credits the wallet if not already credited (idempotent via payment status check)
   */
  private async handlePaymentCaptured(body: any) {
    const paymentEntity = body.payload?.payment?.entity;
    if (!paymentEntity) {
      this.logger.warn('[WEBHOOK] payment.captured missing payload');
      return { status: 'error', reason: 'missing_payload' };
    }

    const { id: gatewayPaymentId, order_id: gatewayOrderId, amount, method } = paymentEntity;

    // Find the payment transaction by gateway order ID
    const payment = await this.payments.findOne({
      where: { gateway_order_id: gatewayOrderId }
    });

    if (!payment) {
      this.logger.warn(`[WEBHOOK] No payment found for order: ${gatewayOrderId}`);
      return { status: 'ignored', reason: 'order_not_found' };
    }

    // Already captured (idempotent) - client confirm already processed this
    if (payment.status === 'captured') {
      this.logger.log(`[WEBHOOK] Payment already captured: ${payment.id}`);
      return { status: 'already_processed', payment_id: payment.id };
    }

    // If payment is not in pending state, skip
    if (payment.status !== 'pending') {
      this.logger.warn(`[WEBHOOK] Payment in unexpected state: ${payment.status} for ${payment.id}`);
      return { status: 'ignored', reason: `unexpected_state_${payment.status}` };
    }

    // Check expiry
    if (payment.expires_at && payment.expires_at < new Date()) {
      this.logger.warn(`[WEBHOOK] Payment expired: ${payment.id}`);
      await this.payments.update(payment.id, { status: 'failed', metadata: { ...payment.metadata, failure_reason: 'expired' } } as any);
      return { status: 'expired', payment_id: payment.id };
    }

    // Credit wallet in a transaction
    return this.dataSource.transaction(async manager => {
      const wallet = await manager.findOne(Wallet, { where: { id: payment.wallet_id } });
      if (!wallet) {
        this.logger.error(`[WEBHOOK] Wallet not found: ${payment.wallet_id}`);
        return { status: 'error', reason: 'wallet_not_found' };
      }

      if (wallet.status === 'frozen') {
        this.logger.warn(`[WEBHOOK] Wallet frozen, marking payment as held: ${wallet.id}`);
        await manager.update(PaymentTransaction, payment.id, {
          status: 'failed',
          gateway_payment_id: gatewayPaymentId,
          metadata: { ...payment.metadata, failure_reason: 'wallet_frozen', gateway_method: method }
        } as any);
        return { status: 'wallet_frozen', payment_id: payment.id };
      }

      const oldBalance = wallet.cached_balance;
      const creditAmount = payment.amount; // Use our stored amount, not gateway amount (safety)
      const newBalance = oldBalance + creditAmount;

      // Optimistic locking: update wallet
      const updateResult = await manager.update(
        Wallet,
        { id: wallet.id, version: wallet.version },
        {
          cached_balance: newBalance,
          available_balance: wallet.available_balance + creditAmount,
          version: wallet.version + 1,
        }
      );

      if (updateResult.affected === 0) {
        // Optimistic lock conflict - Razorpay will retry the webhook
        this.logger.warn(`[WEBHOOK] Optimistic lock conflict for wallet: ${wallet.id}`);
        throw new Error('OPTIMISTIC_LOCK_CONFLICT');
      }

      // Create wallet transaction
      const txn = await manager.save(WalletTransaction, {
        wallet_id: wallet.id,
        idempotency_key: `webhook_${gatewayPaymentId}_${payment.id}`,
        txn_type: 'credit',
        txn_category: 'topup',
        amount: creditAmount,
        running_balance: newBalance,
        description: `Top-up via ${payment.gateway_provider} (webhook)`,
        reference_type: 'payment_transaction',
        reference_id: String(payment.id),
        status: 'completed',
        completed_at: new Date(),
      });

      // Link payment to wallet transaction
      await manager.save(TransactionLink, {
        payment_txn_id: payment.id,
        wallet_txn_id: txn.id,
      });

      // Update payment transaction status
      await manager.update(PaymentTransaction, payment.id, {
        status: 'captured',
        gateway_payment_id: gatewayPaymentId,
        captured_at: new Date(),
        payment_method: method,
        metadata: { ...payment.metadata, captured_via: 'webhook', gateway_method: method },
      } as any);

      // Update topup limits
      await this.incrementLimits(manager, wallet.id, creditAmount);

      // Audit log
      await manager.save(WalletAuditLog, {
        wallet_id: wallet.id,
        actor_type: 'gateway_webhook',
        action: 'topup_confirmed_webhook',
        entity_type: 'payment_transaction',
        entity_id: 0,
        old_state: { balance: oldBalance },
        new_state: { balance: newBalance },
      } as any);

      this.logger.log(`[WEBHOOK] Payment captured: ${payment.id}, credited ${money(creditAmount)} to wallet ${wallet.id}`);

      return {
        status: 'captured',
        payment_id: payment.id,
        wallet_id: wallet.id,
        credited_amount: creditAmount,
        new_balance: newBalance,
      };
    });
  }

  /**
   * Handle payment.failed event
   * Marks the payment as failed and logs the failure reason
   */
  private async handlePaymentFailed(body: any) {
    const paymentEntity = body.payload?.payment?.entity;
    if (!paymentEntity) {
      return { status: 'error', reason: 'missing_payload' };
    }

    const { id: gatewayPaymentId, order_id: gatewayOrderId, error_code, error_description, error_reason } = paymentEntity;

    const payment = await this.payments.findOne({
      where: { gateway_order_id: gatewayOrderId }
    });

    if (!payment) {
      this.logger.warn(`[WEBHOOK] No payment found for failed order: ${gatewayOrderId}`);
      return { status: 'ignored', reason: 'order_not_found' };
    }

    // Already in terminal state
    if (payment.status === 'captured' || payment.status === 'failed') {
      return { status: 'already_processed', payment_id: payment.id };
    }

    await this.payments.update(payment.id, {
      status: 'failed',
      gateway_payment_id: gatewayPaymentId,
      metadata: {
        ...payment.metadata,
        failure_via: 'webhook',
        error_code,
        error_description,
        error_reason,
      },
    } as any);

    // Audit log
    await this.auditLogs.save({
      wallet_id: payment.wallet_id,
      actor_type: 'gateway_webhook',
      action: 'payment_failed',
      entity_type: 'payment_transaction',
      entity_id: 0,
      old_state: { status: 'pending' },
      new_state: { status: 'failed', error_code, error_reason },
    } as any);

    this.logger.log(`[WEBHOOK] Payment failed: ${payment.id}, reason: ${error_reason || error_description}`);

    return { status: 'failed', payment_id: payment.id, error_code };
  }

  /**
   * Handle refund.created event
   * Logs the refund event (actual refund processing can be added later)
   */
  private async handleRefundCreated(body: any) {
    const refundEntity = body.payload?.refund?.entity;
    if (!refundEntity) {
      return { status: 'error', reason: 'missing_payload' };
    }

    const { payment_id: gatewayPaymentId, amount, id: refundId } = refundEntity;

    this.logger.log(`[WEBHOOK] Refund created: ${refundId} for payment ${gatewayPaymentId}, amount: ${amount}`);

    // Find associated payment
    const payment = await this.payments.findOne({
      where: { gateway_payment_id: gatewayPaymentId }
    });

    if (payment) {
      await this.auditLogs.save({
        wallet_id: payment.wallet_id,
        actor_type: 'gateway_webhook',
        action: 'refund_created',
        entity_type: 'payment_transaction',
        entity_id: 0,
        old_state: { status: payment.status },
        new_state: { refund_id: refundId, refund_amount: amount },
      } as any);
    }

    return { status: 'acknowledged', refund_id: refundId };
  }

  // Increment topup limits (same logic as TopUpService)
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
        amount_used: amount,
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
        amount_used: amount,
      });
    }
  }

  /**
   * Test endpoint: Simulate a webhook event (only works in mock mode)
   * Useful for testing the add-money flow end-to-end without Razorpay
   */
  @Post('simulate')
  @HttpCode(200)
  async simulateWebhook(@Body() body: { payment_txn_id: string; event?: string }) {
    if (!this.razorpay.isMock()) {
      return { status: 'error', reason: 'simulation_only_in_mock_mode' };
    }

    const { payment_txn_id, event = 'payment.captured' } = body;

    const payment = await this.payments.findOne({ where: { id: payment_txn_id } });
    if (!payment) {
      return { status: 'error', reason: 'payment_not_found' };
    }

    // Build a simulated Razorpay webhook payload
    const simulatedPayload: any = {
      event,
      payload: {
        payment: {
          entity: {
            id: `pay_sim_${Date.now()}`,
            order_id: payment.gateway_order_id,
            amount: payment.amount,
            currency: payment.currency_code,
            status: event === 'payment.captured' ? 'captured' : 'failed',
            method: 'upi',
          },
        },
      },
    };

    // Generate valid signature for the simulated payload
    const rawBody = JSON.stringify(simulatedPayload);
    const signature = this.razorpay.generateWebhookSignature(rawBody);

    this.logger.log(`[SIMULATE] Firing ${event} webhook for payment: ${payment_txn_id}`);

    // Process as a real webhook
    return this.handleWebhook(simulatedPayload, signature, null);
  }
}
