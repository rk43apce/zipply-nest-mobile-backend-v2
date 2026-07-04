import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerModule } from '../customer/customer.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { Customer, CustomerOrder, OrderDispatch, OrderEvent, OrderRating, Rider, Wallet } from '../entities';
import { WalletModule } from '../wallet/wallet.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CustomerOrder, OrderDispatch, OrderEvent, OrderRating, Wallet, Rider, Customer]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.get('JWT_SECRET') || 'your-secret-key-256-bit-minimum', signOptions: { expiresIn: config.get('JWT_EXPIRES_IN') || '7d' } })
    }),
    CustomerModule,
    WalletModule,
    DispatchModule
  ],
  providers: [OrdersService],
  controllers: [OrdersController],
  exports: [OrdersService]
})
export class OrdersModule {}
