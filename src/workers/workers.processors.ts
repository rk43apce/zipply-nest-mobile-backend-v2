import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
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
  constructor(@InjectRepository(RiderLocation) private locations: Repository<RiderLocation>) { super(); }
  async process(job: Job<any>) {
    await this.locations.save({ rider_id: job.data.rider_id, lat: job.data.lat, lng: job.data.lng, speed: job.data.speed, bearing: job.data.bearing });
  }
}

@Injectable()
export class TimeoutProcessor implements OnModuleInit {
  constructor(private dispatch: DispatchService) {}
  async onModuleInit() {
    setInterval(() => this.dispatch.expireOffers().catch(() => undefined), 2000);
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
      if (st.last_seen && Date.now() - Date.parse(st.last_seen) > 120000) {
        const riderId = key.split(':').pop();
        if (riderId) await this.redis.zrem('riders:online', riderId);
        if (st.city && riderId) await this.redis.zrem(`riders:online:${st.city}`, riderId);
        await this.redis.hset(key, { status: 'offline', current_order_id: '' });
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
