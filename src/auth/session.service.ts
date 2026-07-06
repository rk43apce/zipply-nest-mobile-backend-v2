import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserActiveSession, DeviceFingerprint } from '../entities';
import * as crypto from 'crypto';

@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(UserActiveSession) private sessions: Repository<UserActiveSession>,
    @InjectRepository(DeviceFingerprint) private fingerprints: Repository<DeviceFingerprint>
  ) {}

  // Create or replace session for rider
  async createSession(
    userId: string,
    userType: string,
    deviceId: string,
    deviceHash: string,
    tokenHash: string,
    deviceName?: string,
    ipAddress?: string
  ) {
    // Find existing session for this user
    const existingSession = await this.sessions.findOne({
      where: { user_id: userId, user_type: userType }
    });

    if (existingSession) {
      // Trigger notification to old device (TODO: integrate with FCM)
      console.log(`[NOTIFICATION] User ${userId} logged in from new device. Invalidate session on device: ${existingSession.device_hash}`);

      // Reuse the existing row — update it in place (avoids unique constraint violation)
      await this.sessions.update(existingSession.id, {
        device_id: deviceId,
        device_hash: deviceHash,
        token_hash: tokenHash,
        device_name: deviceName,
        ip_address: ipAddress,
        is_active: true,
        last_active_at: new Date(),
        invalidated_at: null as any,
        invalidated_reason: null as any
      });

      return { ...existingSession, token_hash: tokenHash, is_active: true };
    }

    // No existing session — create a new one
    const session = await this.sessions.save({
      user_id: userId as any,
      user_type: userType,
      device_id: deviceId,
      device_hash: deviceHash,
      token_hash: tokenHash,
      device_name: deviceName,
      ip_address: ipAddress,
      is_active: true
    } as any);

    return session;
  }

  // Validate session (check if token is still active)
  async validateSession(userId: string, userType: string, tokenHash: string): Promise<boolean> {
    const session = await this.sessions.findOne({
      where: { user_id: userId as any, user_type: userType, is_active: true }
    });

    if (!session) {
      return false;
    }

    if (session.token_hash !== tokenHash) {
      return false;
    }

    // Update last active time
    await this.sessions.update(session.id, {
      last_active_at: new Date()
    });

    return true;
  }

  // Invalidate session (logout)
  async invalidateSession(userId: string, userType: string) {
    await this.sessions.update(
      { user_id: userId as any, user_type: userType, is_active: true },
      { is_active: false, invalidated_at: new Date(), invalidated_reason: 'User logout' }
    );
  }

  // Register device fingerprint
  async registerDevice(
    userId: string,
    userType: string,
    deviceId: string,
    deviceMeta: Record<string, any>
  ) {
    const deviceHash = this.generateDeviceHash(deviceId, deviceMeta);

    let fingerprint = await this.fingerprints.findOne({
      where: { user_id: userId as any, user_type: userType, device_hash: deviceHash }
    });

    if (!fingerprint) {
      fingerprint = await this.fingerprints.save({
        user_id: userId as any,
        user_type: userType,
        device_id: deviceId,
        device_hash: deviceHash,
        device_meta: deviceMeta
      } as any);
    } else {
      // Update last seen
      await this.fingerprints.update(fingerprint.id, {
        last_seen_at: new Date()
      });
    }

    // Check for shared accounts (multiple users on same device)
    const otherUsers = await this.fingerprints.find({
      where: { device_hash: deviceHash }
    });

    return {
      registered: true,
      is_flagged: otherUsers.length > 1,
      shared_accounts: otherUsers.length - 1,
      warning: otherUsers.length > 1 ? 'This device is associated with multiple accounts' : null
    };
  }

  // Helper: Generate device hash
  private generateDeviceHash(deviceId: string, deviceMeta: Record<string, any>): string {
    const data = JSON.stringify({ deviceId, ...deviceMeta });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  // Helper: Generate token hash
  generateTokenHash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
