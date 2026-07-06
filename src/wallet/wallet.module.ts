import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { 
  Wallet, WalletTransaction, PaymentTransaction, WalletHold, TopupLimitTracker,
  WalletAuditLog, CommissionLedger, TripPayment, BusinessRule, RiderWithdrawal,
  RefundRequest, FraudFlag, TransactionLink
} from '../entities';
import { WalletController } from './wallet.controller';
import { CustomerWalletController } from './customer-wallet.controller';
import { WalletService } from './wallet.service';
import { TopUpService } from './topup.service';
import { WithdrawalService } from './withdrawal.service';
import { CashPaymentService } from './cash-payment.service';
import { CommissionEngine } from './commission.engine';
import { BusinessRulesService } from './business-rules.service';
import { IdempotencyMiddleware } from './idempotency.middleware';

@Module({
  imports: [TypeOrmModule.forFeature([
    Wallet, WalletTransaction, PaymentTransaction, WalletHold, TopupLimitTracker,
    WalletAuditLog, CommissionLedger, TripPayment, BusinessRule, RiderWithdrawal,
    RefundRequest, FraudFlag, TransactionLink
  ])],
  providers: [WalletService, TopUpService, WithdrawalService, CashPaymentService, CommissionEngine, BusinessRulesService],
  controllers: [WalletController, CustomerWalletController],
  exports: [WalletService, TopUpService, WithdrawalService, CashPaymentService, CommissionEngine, BusinessRulesService]
})
export class WalletModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(IdempotencyMiddleware)
      .forRoutes('api/rider/wallet', 'api/customer/wallet');
  }
}
