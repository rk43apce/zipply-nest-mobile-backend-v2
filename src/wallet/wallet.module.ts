import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentTransaction, TopupLimitTracker, Wallet, WalletHold, WalletTransaction } from '../entities';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet, PaymentTransaction, WalletTransaction, WalletHold, TopupLimitTracker])],
  providers: [WalletService],
  controllers: [WalletController],
  exports: [WalletService]
})
export class WalletModule {}
