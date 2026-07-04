import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DispatchModule } from '../dispatch/dispatch.module';
import { redisProvider } from '../common/redis.provider';
import { BackgroundCheck, CustomerOrder, PaymentTransaction, Rider, RiderDocument, RiderLocation, Wallet, WalletHold } from '../entities';
import { OnboardingProcessor, PaymentMaintenance, StaleCleanup, TelemetryProcessor, TimeoutProcessor } from './workers.processors';

@Module({
  imports: [TypeOrmModule.forFeature([Rider, RiderDocument, BackgroundCheck, RiderLocation, WalletHold, Wallet, CustomerOrder, PaymentTransaction]), BullModule.registerQueue({ name: 'onboarding' }, { name: 'telemetry' }, { name: 'dispatch-timeouts' }, { name: 'maintenance' }), DispatchModule],
  providers: [OnboardingProcessor, TelemetryProcessor, TimeoutProcessor, StaleCleanup, PaymentMaintenance, redisProvider]
})
export class WorkersModule {}
