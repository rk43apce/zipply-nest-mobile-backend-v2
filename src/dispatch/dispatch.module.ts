import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';
import { redisProvider } from '../common/redis.provider';
import { CustomerOrder, DispatchEvent, DispatchOffer, OrderDispatch, Rider, RiderEarning, RiderLocation } from '../entities';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [TypeOrmModule.forFeature([Rider, OrderDispatch, DispatchOffer, DispatchEvent, RiderEarning, RiderLocation, CustomerOrder]), BullModule.registerQueue({ name: 'telemetry' }, { name: 'dispatch-timeouts' }), RealtimeModule],
  providers: [DispatchService, redisProvider],
  controllers: [DispatchController],
  exports: [DispatchService]
})
export class DispatchModule {}
