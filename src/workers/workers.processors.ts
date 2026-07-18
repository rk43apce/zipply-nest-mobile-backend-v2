import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { DataSource } from 'typeorm';
import { REDIS } from '../common/redis.provider';
import { BackgroundCheck, CustomerOrder, PaymentTransaction, Rider, RiderDocument, RiderLocation, Wallet, WalletHold } from '../entities';
import { DispatchService } from '../dispatch/dispatch.service';

@Processor('onboarding')
export class OnboardingProcessor extends WorkerHost {
  constructor(@InjectRepository(RiderDocument) private docs: Repository<RiderDocument>, @InjectRepository(Rider) private riders: Repository<Rider>, @InjectRepository(BackgroundCheck) private bgs: Repository<BackgroundCheck>) { super(); }
  async process(job: Job<{ riderId: string }>) {
    if (job.name === 'auto-verify-documents') {
      await this.docs.update({ rider_id: job.data.riderId }, { verification_status: 'verified', verified_at: new Date() });
      await this.riders.update(job.data.riderId, { onboarding_status: 'documents_verified' });
    }
    if (job.name === 'auto-clear-background') {
      await this.bgs.update({ rider_id: job.data.riderId, status: 'pending' }, { status: 'cleared', completed_at: new Date() });
      await this.riders.update(job.data.riderId, { onboarding_status: 'background_check_cleared' });
    }
  }
}

@Processor('telemetry')
export class TelemetryProcessor extends WorkerHost {
  private readonly logger = new Logger(TelemetryProcessor.name);
  constructor(@InjectRepository(RiderLocation) private locations: Repository<RiderLocation>) { super(); }
  async process(job: Job<any>) {
    const saved = await this.locations.save({
      rider_id: job.data.rider_id,
      lat: job.data.lat,
      lng: job.data.lng,
      accuracy: job.data.accuracy,
      speed: job.data.speed,
      bearing: job.data.bearing,
      gps_timestamp: job.data.gps_timestamp ? new Date(job.data.gps_timestamp) : undefined,
    });
    this.logger.log(JSON.stringify({
      event: 'ZipplyDbLocationUpdated',
      rider_id: job.data.rider_id,
      location_id: saved.id,
      lat: job.data.lat,
      lng: job.data.lng,
      accuracy: job.data.accuracy ?? null,
      gps_timestamp: job.data.gps_timestamp ?? null,
      recorded_at: saved.recorded_at,
    }));
  }
}

@Injectable()
export class TimeoutProcessor implements OnModuleInit {
  constructor(private dispatch: DispatchService) {}
  async onModuleInit() {
    setInterval(() => this.dispatch.expireOffers().catch(() => undefined), 2000);
    // Auto-cancel dispatches that have been searching for > 3 minutes with no assignment
    setInterval(() => this.dispatch.autoExpireDispatches().catch(() => undefined), 10000);
  }
}

@Injectable()
export class StaleCleanup implements OnModuleInit {
  constructor(@Inject(REDIS) private redis: Redis) {}
  async onModuleInit() {
    setInterval(() => this.cleanup().catch(() => undefined), 30000);
  }
  async cleanup() {
    const keys = await this.redis.keys('rider:status:*');
    for (const key of keys) {
      const st = await this.redis.hgetall(key);
      if (st.last_seen) {
        const staleDuration = Date.now() - Date.parse(st.last_seen);
        // P2-4 FIX: Increase grace period for on_trip riders from 2min to 5min
        // on_trip = actively delivering, needs more tolerance for network hiccups
        // busy = waiting for offers, should be more responsive
        const staleThreshold = st.status === 'on_trip' ? 300000 : 120000;
        if (staleDuration > staleThreshold) {
          const riderId = key.split(':').pop();
          // Only mark as offline if rider is actively 'busy' or 'on_trip' but has gone stale
          // Never mark 'available' riders as offline — they may be resting between deliveries
          if (['busy', 'on_trip'].includes(st.status)) {
            if (riderId) await this.redis.zrem('riders:online', riderId);
            if (st.city && riderId) await this.redis.zrem(`riders:online:${st.city}`, riderId);
            await this.redis.hset(key, { status: 'offline', current_order_id: '' });
          }
        }
      }
    }
  }
}

@Injectable()
export class PaymentMaintenance implements OnModuleInit {
  constructor(private dataSource: DataSource) {}
  async onModuleInit() {
    setInterval(() => this.cleanup().catch(() => undefined), 300000);
  }
  async cleanup() {
    await this.dataSource.transaction(async manager => {
      const expiredHolds = await manager.createQueryBuilder(WalletHold, 'h').where('h.status = :status', { status: 'active' }).andWhere('h.expires_at < NOW()').take(100).getMany();
      for (const hold of expiredHolds) {
        const wallet = await manager.findOneBy(Wallet, { id: hold.wallet_id });
        if (wallet) await manager.update(Wallet, wallet.id, { available_balance: wallet.available_balance + hold.amount, version: wallet.version + 1 });
        await manager.update(WalletHold, hold.id, { status: 'expired', released_at: new Date() });
        if (hold.reference_type === 'order' && hold.reference_id) {
          await manager.update(CustomerOrder, { order_id: hold.reference_id, status: 'payment_pending' }, { status: 'cancelled', cancel_reason: 'Payment hold expired', cancelled_at: new Date() });
        }
      }
      await manager.createQueryBuilder().update(PaymentTransaction).set({ status: 'failed' }).where('status = :status', { status: 'pending' }).andWhere('expires_at < NOW()').execute();
    });
  }
}

// P1-2 FIX: Monitor stuck offers that never get acknowledged
@Injectable()
export class StuckOffersDetection implements OnModuleInit {
  constructor(@InjectRepository(CustomerOrder) private orders: Repository<CustomerOrder>, @Inject(REDIS) private redis: Redis) {}
  async onModuleInit() {
    // Run every 60 seconds to detect offers stuck for >5 minutes
    setInterval(() => this.detectStuckOffers().catch(() => undefined), 60000);
  }
  async detectStuckOffers() {
    // Find dispatch offers still pending after 5+ minutes (no accept/reject/timeout)
    const query = `
      SELECT do.id, do.order_id, do.riders_offered_count, COUNT(o.id) as pending_count
      FROM order_dispatches do
      LEFT JOIN dispatch_offers o ON do.id = o.dispatch_id AND o.status = 'pending'
      WHERE do.status IN ('offered', 'searching')
      AND EXTRACT(EPOCH FROM (NOW() - do.started_at)) > 300
      GROUP BY do.id
      HAVING COUNT(o.id) > 0
      LIMIT 20
    `;
    
    try {
      const stuck = await this.orders.query(query);
      for (const dispatch of stuck) {
        // Mark in Redis for monitoring/alerting
        await this.redis.hset(`stuck:dispatch:${dispatch.id}`, {
          order_id: dispatch.order_id,
          stuck_for_seconds: Math.round((Date.now() - new Date(dispatch.started_at).getTime()) / 1000),
          pending_offers: dispatch.pending_count,
          total_offered: dispatch.riders_offered_count
        });
      }
    } catch (_) {
      // Database query failed, skip this cycle
    }
  }
}

// P1-4 FIX: Monitor rides stuck in intermediate states (>30min in assigned/en_route_pickup)
@Injectable()
export class StuckRidesMonitoring implements OnModuleInit {
  constructor(@InjectRepository(CustomerOrder) private orders: Repository<CustomerOrder>, @Inject(REDIS) private redis: Redis) {}
  async onModuleInit() {
    // Run every 5 minutes to detect stuck rides
    setInterval(() => this.detectStuckRides().catch(() => undefined), 300000);
  }
  async detectStuckRides() {
    // Find rides stuck in intermediate states for >30 minutes
    const query = `
      SELECT do.id, do.order_id, do.assigned_rider_id, do.status,
             EXTRACT(EPOCH FROM (NOW() - COALESCE(do.assigned_at, do.started_at))) as stuck_seconds
      FROM order_dispatches do
      WHERE do.status IN ('assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'in_transit')
      AND EXTRACT(EPOCH FROM (NOW() - COALESCE(do.assigned_at, do.started_at))) > 1800
      LIMIT 50
    `;
    
    try {
      const stuckRides = await this.orders.query(query);
      for (const ride of stuckRides) {
        // Flag stuck ride in Redis for admin investigation
        await this.redis.hset(`stuck:ride:${ride.id}`, {
          order_id: ride.order_id,
          rider_id: ride.assigned_rider_id,
          status: ride.status,
          stuck_minutes: Math.round(ride.stuck_seconds / 60)
        });
        // Emit alert via Redis pub/sub for real-time monitoring
        await this.redis.publish('alerts:stuck_rides', JSON.stringify({
          dispatch_id: ride.id,
          order_id: ride.order_id,
          status: ride.status,
          stuck_minutes: Math.round(ride.stuck_seconds / 60)
        }));
      }
    } catch (_) {
      // Database query failed, skip this cycle
    }
  }
}
