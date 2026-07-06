import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from './auth/auth.module';
import { RiderModule } from './rider/rider.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { EarningsModule } from './earnings/earnings.module';
import { RealtimeModule } from './realtime/realtime.module';
import { WorkersModule } from './workers/workers.module';
import { CustomerModule } from './customer/customer.module';
import { WalletModule } from './wallet/wallet.module';
import { OrdersModule } from './orders/orders.module';
import { entities } from './entities';
import { SessionValidationMiddleware } from './auth/session-validation.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL') || 'postgresql://vida:password@localhost:5433/vida_rider',
        entities,
        synchronize: false
      })
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get('REDIS_URL') || 'redis://localhost:6379' }
      })
    }),
    AuthModule,
    RiderModule,
    DispatchModule,
    EarningsModule,
    RealtimeModule,
    CustomerModule,
    WalletModule,
    OrdersModule,
    WorkersModule
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SessionValidationMiddleware).forRoutes('api');
  }
}
