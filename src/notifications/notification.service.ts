import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';

type FcmSendResult = {
  attempted: boolean;
  sent: boolean;
  reason?: string;
  message_id?: string;
  error?: string;
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private firebaseApp: any | null | undefined;

  constructor(private readonly config: ConfigService) {}

  async sendOrderOffer(
    token: string | null | undefined,
    payload: Record<string, any>,
  ): Promise<FcmSendResult> {
    return this.sendToRider(token, {
      type: 'order_offer',
      offer_id: payload.offer_id,
      order_id: payload.order_id,
      order_reference: payload.order_reference,
      offer_created_at: payload.offer_created_at,
      offer_expires_at: payload.offer_expires_at,
      expires_at: payload.expires_at,
      timeout_seconds: payload.timeout_seconds,
      payload,
    });
  }

  async sendOfferCancelled(
    token: string | null | undefined,
    payload: Record<string, any>,
  ): Promise<FcmSendResult> {
    return this.sendToRider(token, {
      type: 'offer_cancelled',
      offer_id: payload.offer_id,
      reason: payload.reason,
      payload,
    });
  }

  async sendOrderAssigned(
    token: string | null | undefined,
    payload: Record<string, any>,
  ): Promise<FcmSendResult> {
    return this.sendToRider(token, {
      type: 'order_assigned_confirmed',
      offer_id: payload.offer_id,
      order_id: payload.order_id,
      payload,
    });
  }

  /**
   * Send a push notification to a customer.
   * Used for order status updates: rider_assigned, picked_up, in_transit, delivered, order_cancelled.
   */
  async sendToCustomer(
    token: string | null | undefined,
    body: Record<string, any>,
  ): Promise<FcmSendResult> {
    if (!token) return { attempted: false, sent: false, reason: 'missing_token' };

    const app = this.firebase();
    if (!app) {
      return { attempted: false, sent: false, reason: 'firebase_not_configured' };
    }

    try {
      const admin = this.firebaseAdmin();
      const messageId = await admin.messaging(app).send({
        token,
        android: { priority: 'high' },
        data: this.toFcmData(body),
        notification: this.notificationFor(body),
      });
      this.log('fcm_customer_send_success', {
        type: body.type,
        order_id: body.order_id,
        message_id: messageId,
        token_suffix: token.slice(-6),
      });
      return { attempted: true, sent: true, message_id: messageId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log('fcm_customer_send_failed', {
        type: body.type,
        order_id: body.order_id,
        error: message,
        token_suffix: token.slice(-6),
      });
      return { attempted: true, sent: false, error: message };
    }
  }

  private async sendToRider(
    token: string | null | undefined,
    body: Record<string, any>,
  ): Promise<FcmSendResult> {
    if (!token) return { attempted: false, sent: false, reason: 'missing_token' };

    const app = this.firebase();
    if (!app) {
      return { attempted: false, sent: false, reason: 'firebase_not_configured' };
    }

    try {
      const admin = this.firebaseAdmin();
      const messageId = await admin.messaging(app).send({
        token,
        android: { priority: 'high' },
        data: this.toFcmData(body),
        notification: this.notificationFor(body),
      });
      this.log('fcm_send_success', {
        type: body.type,
        offer_id: body.offer_id,
        order_id: body.order_id,
        message_id: messageId,
        token_suffix: token.slice(-6),
      });
      return { attempted: true, sent: true, message_id: messageId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log('fcm_send_failed', {
        type: body.type,
        offer_id: body.offer_id,
        order_id: body.order_id,
        error: message,
        token_suffix: token.slice(-6),
      });
      return { attempted: true, sent: false, error: message };
    }
  }

  private firebase() {
    if (this.firebaseApp !== undefined) return this.firebaseApp;

    try {
      const admin = this.firebaseAdmin();
      if (admin.apps?.length) {
        this.firebaseApp = admin.app();
        return this.firebaseApp;
      }

      const credential = this.firebaseCredential(admin);
      if (!credential) {
        this.firebaseApp = null;
        this.log('fcm_disabled_missing_credentials', {});
        return null;
      }

      this.firebaseApp = admin.initializeApp({ credential });
      this.log('fcm_initialized', {});
      return this.firebaseApp;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.firebaseApp = null;
      this.log('fcm_disabled_initialization_failed', { error: message });
      return null;
    }
  }

  private firebaseAdmin() {
    // Keep Firebase Admin optional for local/dev until the dependency and
    // credentials are configured in production.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('firebase-admin');
  }

  private firebaseCredential(admin: any) {
    const file = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_FILE');
    if (file) {
      return admin.credential.cert(JSON.parse(readFileSync(resolve(file), 'utf8')));
    }

    const json = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (json) {
      return admin.credential.cert(JSON.parse(json));
    }

    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.config.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.config
      .get<string>('FIREBASE_PRIVATE_KEY')
      ?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) return null;
    return admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    });
  }

  private toFcmData(body: Record<string, any>): Record<string, string> {
    const data: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined || value === null) continue;
      data[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    return data;
  }

  private notificationFor(body: Record<string, any>) {
    if (body.type === 'order_offer') {
      const earnings = body.payload?.display_earnings ?? '';
      return {
        title: 'New delivery offer',
        body: earnings ? `Earn ${earnings} on this order` : 'Tap to view offer',
      };
    }
    if (body.type === 'offer_cancelled') {
      return { title: 'Offer no longer available', body: 'Looking for more orders' };
    }
    if (body.type === 'order_assigned_confirmed') {
      return { title: 'Order assigned', body: 'Head to pickup' };
    }
    // Customer notification types
    if (body.type === 'rider_assigned') {
      return { title: 'Rider assigned', body: `${body.rider_name || 'A rider'} is heading to pickup` };
    }
    if (body.type === 'picked_up') {
      return { title: 'Parcel picked up', body: 'Your parcel is on its way to the drop location' };
    }
    if (body.type === 'in_transit') {
      return { title: 'On the way', body: 'Your parcel is being delivered' };
    }
    if (body.type === 'delivered') {
      return { title: 'Parcel delivered!', body: 'Your parcel has been delivered successfully' };
    }
    if (body.type === 'order_cancelled') {
      return { title: 'Order cancelled', body: body.reason || 'Your order has been cancelled' };
    }
    if (body.type === 'rider_cancelled') {
      return { title: 'Finding another rider', body: body.message || 'Your previous rider cancelled. We are searching for another rider.' };
    }
    return undefined;
  }

  private log(event: string, data: Record<string, any>) {
    this.logger.log(JSON.stringify({ event, ...data }));
  }
}
