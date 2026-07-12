import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import Redis from 'ioredis';
import { REDIS } from '../common/redis.provider';
import { Rider, UserActiveSession } from '../entities';

@Injectable()
export class AdminService {
  constructor(
    @Inject(REDIS) private redis: Redis,
    @InjectRepository(Rider) private riders: Repository<Rider>,
    @InjectRepository(UserActiveSession) private sessions: Repository<UserActiveSession>,
  ) {}

  async getLiveRiders() {
    // Get all online rider IDs from Redis geo set
    const onlineRiderIds = await this.redis.zrange('riders:online', 0, -1);

    if (!onlineRiderIds.length) {
      return { total: 0, riders: [] };
    }

    // Fetch Redis status hashes for each rider
    const pipeline = this.redis.pipeline();
    for (const riderId of onlineRiderIds) {
      pipeline.hgetall(`rider:status:${riderId}`);
    }
    const redisResults = await pipeline.exec();

    // Fetch rider profiles from DB
    const riderProfiles = await this.riders.find({
      where: { id: In(onlineRiderIds) },
    });
    const profileMap = new Map(riderProfiles.map(r => [r.id, r]));

    // Fetch active sessions from DB
    const activeSessions = await this.sessions.find({
      where: { user_id: In(onlineRiderIds as any[]), user_type: 'rider', is_active: true },
    });
    const sessionMap = new Map(activeSessions.map(s => [s.user_id, s]));

    // Build response
    const riders = onlineRiderIds.map((riderId, idx) => {
      const redisStatus = (redisResults?.[idx]?.[1] as Record<string, string>) || {};
      const profile = profileMap.get(riderId);
      const session = sessionMap.get(riderId);

      return {
        rider_id: riderId,
        // Live location from Redis
        location: {
          lat: redisStatus.lat ? Number(redisStatus.lat) : null,
          lng: redisStatus.lng ? Number(redisStatus.lng) : null,
          accuracy: redisStatus.accuracy ? Number(redisStatus.accuracy) : null,
          gps_timestamp: redisStatus.gps_timestamp || null,
          last_seen: redisStatus.last_seen || null,
        },
        // Dispatch status from Redis
        status: redisStatus.status || 'unknown',
        city: redisStatus.city || null,
        online_since: redisStatus.online_since || null,
        vehicle_type: redisStatus.vehicle_type || null,
        current_order_id: redisStatus.current_order_id || null,
        // Profile from DB
        profile: profile
          ? {
              mobile: profile.mobile,
              name: profile.name || null,
              gender: profile.gender || null,
              date_of_birth: profile.date_of_birth || null,
              onboarding_status: profile.onboarding_status,
              rating: Number(profile.rating),
              total_deliveries: profile.total_deliveries,
              acceptance_rate: Number(profile.acceptance_rate),
              activated_at: profile.activated_at || null,
            }
          : null,
        // FCM / device details from DB
        fcm: profile
          ? {
              fcm_token: profile.fcm_token || null,
              device_platform: profile.device_platform || null,
              app_type: profile.app_type || null,
              device_id: profile.device_id || null,
              device_token_updated_at: profile.device_token_updated_at || null,
            }
          : null,
        // Session / JWT details from DB
        session: session
          ? {
              token_hash: session.token_hash,
              device_id: session.device_id,
              device_name: session.device_name || null,
              ip_address: session.ip_address || null,
              logged_in_at: session.logged_in_at,
              last_active_at: session.last_active_at,
              is_active: session.is_active,
            }
          : null,
      };
    });

    return { total: riders.length, riders };
  }
}
