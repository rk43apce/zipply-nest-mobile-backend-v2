import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Customer, CustomerOtpRequest, SavedAddress, Wallet } from '../entities';
import { CustomerAuthGuard } from './customer-auth.guard';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, CustomerOtpRequest, SavedAddress, Wallet]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.get('JWT_SECRET') || 'your-secret-key-256-bit-minimum', signOptions: { expiresIn: config.get('JWT_EXPIRES_IN') || '7d' } })
    })
  ],
  providers: [CustomerService, CustomerAuthGuard],
  controllers: [CustomerController],
  exports: [CustomerService, CustomerAuthGuard]
})
export class CustomerModule {}
