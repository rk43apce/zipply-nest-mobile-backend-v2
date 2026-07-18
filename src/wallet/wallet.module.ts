import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { 
  Wallet, WalletTransaction, PaymentTransaction, WalletHold, TopupLimitTracker, CustomerOrder, OrderDispatch,
  WalletAuditLog, CommissionLedger, TripPayment, BusinessRule, RiderWithdrawal,
  RefundRequest, FraudFlag, TransactionLink
} from '../entities';
import { CustomerModule } from '../customer/customer.module';
import { WalletController } from './wallet.controller';
import { CustomerWalletController } from './customer-wallet.controller';
import { RazorpayWebhookController } from './razorpay-webhook.controller';
import { WalletService } from './wallet.service';
import { TopUpService } from './topup.service';
import { WithdrawalService } from './withdrawal.service';
import { CashPaymentService } from './cash-payment.service';
import { CommissionEngine } from './commission.engine';
import { BusinessRulesService } from './business-rules.service';
import { RazorpayService } from './razorpay.service';
import { PayoutProcessorService } from './payout-processor.service';
import { IdempotencyMiddleware } from './idempotency.middleware';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Wallet, WalletTransaction, PaymentTransaction, WalletHold, TopupLimitTracker,
      WalletAuditLog, CommissionLedger, TripPayment, BusinessRule, RiderWithdrawal,
      RefundRequest, FraudFlag, TransactionLink, CustomerOrder, OrderDispatch
    ]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.get('JWT_SECRET') || 'your-secret-key-256-bit-minimum', signOptions: { expiresIn: config.get('JWT_EXPIRES_IN') || '7d' } })
    }),
    CustomerModule,
  ],
  providers: [WalletService, TopUpService, WithdrawalService, CashPaymentService, CommissionEngine, BusinessRulesService, RazorpayService, PayoutProcessorService],
  controllers: [WalletController, CustomerWalletController, RazorpayWebhookController],
  exports: [WalletService, TopUpService, WithdrawalService, CashPaymentService, CommissionEngine, BusinessRulesService, RazorpayService, PayoutProcessorService]
})
export class WalletModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(IdempotencyMiddleware)
      .forRoutes('api/rider/wallet', 'api/customer/wallet');
  }
}
