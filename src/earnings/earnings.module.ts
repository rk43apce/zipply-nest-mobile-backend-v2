import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EarningsController } from './earnings.controller';
import { EarningsService } from './earnings.service';
import { BankAccount, OrderDispatch, Rider, RiderEarning } from '../entities';

@Module({
  imports: [TypeOrmModule.forFeature([Rider, RiderEarning, OrderDispatch, BankAccount])],
  controllers: [EarningsController],
  providers: [EarningsService]
})
export class EarningsModule {}
