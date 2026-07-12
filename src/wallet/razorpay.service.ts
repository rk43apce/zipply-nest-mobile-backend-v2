import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import Razorpay = require('razorpay');

export interface RazorpayOrder {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string;
  receipt: string;
  created_at: number;
}

export interface RazorpayPaymentEvent {
  event: string;
  payload: {
    payment: {
      entity: {
        id: string;
        order_id: string;
        amount: number;
        currency: string;
        status: string;
        method: string;
        description?: string;
      };
    };
  };
}

@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;
  private readonly isMockMode: boolean;
  private readonly razorpayInstance: InstanceType<typeof Razorpay> | null;

  constructor(private config: ConfigService) {
    this.keyId = this.config.get('RAZORPAY_KEY_ID') || 'rzp_test_mock_key';
    this.keySecret = this.config.get('RAZORPAY_KEY_SECRET') || 'mock_secret_key_for_dev';
    this.webhookSecret = this.config.get('RAZORPAY_WEBHOOK_SECRET') || 'mock_webhook_secret';
    this.isMockMode = this.keyId.startsWith('rzp_test_mock');

    if (this.isMockMode) {
      this.logger.warn('Razorpay running in MOCK mode - no real payments will be processed');
      this.razorpayInstance = null;
    } else {
      this.razorpayInstance = new Razorpay({
        key_id: this.keyId,
        key_secret: this.keySecret,
      });
      this.logger.log(`Razorpay initialized with key: ${this.keyId.slice(0, 12)}...`);
    }
  }

  /**
   * Create a Razorpay order.
   * In production: calls Razorpay Orders API.
   * In mock mode: returns a simulated order.
   */
  async createOrder(amount: number, currency: string, receipt: string): Promise<RazorpayOrder> {
    if (this.isMockMode) {
      return this.mockCreateOrder(amount, currency, receipt);
    }

    this.logger.log(`[RAZORPAY] Creating order: amount=${amount}, currency=${currency}, receipt=${receipt}`);

    try {
      const order = await this.razorpayInstance.orders.create({
        amount,
        currency,
        receipt,
      });

      this.logger.log(`[RAZORPAY] Order created: ${order.id}`);

      return {
        id: order.id,
        entity: order.entity,
        amount: Number(order.amount),
        currency: order.currency,
        status: order.status,
        receipt: order.receipt || receipt,
        created_at: Number(order.created_at),
      };
    } catch (error: any) {
      this.logger.error(`[RAZORPAY] Order creation failed: ${error?.error?.description || error?.message || JSON.stringify(error)}`);
      throw new Error(`Razorpay order creation failed: ${error?.error?.description || error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Verify payment signature from client-side checkout.
   * Uses HMAC-SHA256: sha256(order_id|payment_id, key_secret)
   */
  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    const payload = `${orderId}|${paymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.keySecret)
      .update(payload)
      .digest('hex');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex'),
    );

    if (!isValid) {
      this.logger.warn(`[RAZORPAY] Signature verification failed for order: ${orderId}, payment: ${paymentId}`);
    }

    return isValid;
  }

  /**
   * Verify webhook signature from Razorpay server.
   * Uses HMAC-SHA256 with webhook secret.
   */
  verifyWebhookSignature(body: string, signature: string): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(body)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex'),
      );
    } catch {
      return false;
    }
  }

  /**
   * Fetch payment details from Razorpay (for reconciliation).
   */
  async fetchPayment(paymentId: string): Promise<any> {
    if (this.isMockMode) {
      return { id: paymentId, status: 'captured', amount: 0 };
    }
    return this.razorpayInstance.payments.fetch(paymentId);
  }

  /**
   * Generate a mock signature for testing (used by client in dev mode).
   */
  generateSignature(orderId: string, paymentId: string): string {
    const payload = `${orderId}|${paymentId}`;
    return crypto
      .createHmac('sha256', this.keySecret)
      .update(payload)
      .digest('hex');
  }

  /**
   * Generate a webhook signature for testing.
   */
  generateWebhookSignature(body: string): string {
    return crypto
      .createHmac('sha256', this.webhookSecret)
      .update(body)
      .digest('hex');
  }

  getKeyId(): string {
    return this.keyId;
  }

  isMock(): boolean {
    return this.isMockMode;
  }

  // Mock: Simulate Razorpay order creation
  private mockCreateOrder(amount: number, currency: string, receipt: string): RazorpayOrder {
    const orderId = `order_mock_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.logger.log(`[MOCK] Created Razorpay order: ${orderId} for amount ${amount} ${currency}`);

    return {
      id: orderId,
      entity: 'order',
      amount,
      currency,
      status: 'created',
      receipt,
      created_at: Math.floor(Date.now() / 1000),
    };
  }
}
