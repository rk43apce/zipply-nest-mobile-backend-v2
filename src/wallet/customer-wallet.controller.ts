import { Body, Controller, Get, Param, Post, Query, UseGuards, Request, HttpStatus } from '@nestjs/common';
import { CustomerAuthGuard } from '../customer/customer-auth.guard';
import { ApiError } from '../common/api-error';
import { WalletService } from './wallet.service';
import { TopUpService } from './topup.service';

@Controller('customer/wallet')
@UseGuards(CustomerAuthGuard)
export class CustomerWalletController {
  constructor(
    private wallet: WalletService,
    private topup: TopUpService,
  ) {}

  // Get customer wallet balance
  @Get(':customerId')
  async getBalance(@Param('customerId') customerId: string, @Request() req: any) {
    this.validateCustomerId(req, customerId);
    return await this.wallet.getCustomerWallet(customerId);
  }

  // Get customer transactions
  @Get(':customerId/transactions')
  async getTransactions(
    @Param('customerId') customerId: string,
    @Request() req: any,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
    @Query('type') txnType?: string
  ) {
    this.validateCustomerId(req, customerId);
    return await this.wallet.getTransactions(customerId, parseInt(page || '1'), parseInt(perPage || '20'), txnType);
  }

  // Initiate wallet top-up (creates Razorpay order)
  @Post(':customerId/topup/initiate')
  async initiateTopup(
    @Param('customerId') customerId: string,
    @Body() body: { amount: number; idempotency_key: string; gateway?: string },
    @Request() req: any
  ) {
    this.validateCustomerId(req, customerId);
    if (!body.amount || body.amount <= 0) {
      throw new ApiError('INVALID_AMOUNT', 'Amount must be positive', HttpStatus.BAD_REQUEST);
    }
    if (!body.idempotency_key) {
      throw new ApiError('IDEMPOTENCY_REQUIRED', 'idempotency_key is required', HttpStatus.BAD_REQUEST);
    }
    return await this.topup.initiateCustomerTopUp(customerId, body.amount, body.gateway || 'razorpay', body.idempotency_key);
  }

  // Confirm wallet top-up (verify Razorpay payment + credit wallet)
  @Post(':customerId/topup/confirm')
  async confirmTopup(
    @Param('customerId') customerId: string,
    @Body() body: { payment_txn_id: string; gateway_payment_id: string; gateway_signature: string; razorpay_order_id?: string },
    @Request() req: any
  ) {
    this.validateCustomerId(req, customerId);
    if (!body.payment_txn_id || !body.gateway_payment_id || !body.gateway_signature) {
      throw new ApiError('INVALID_REQUEST', 'payment_txn_id, gateway_payment_id, and gateway_signature are required', HttpStatus.BAD_REQUEST);
    }
    return await this.topup.confirmCustomerTopUp(customerId, body.payment_txn_id, body.gateway_payment_id, body.gateway_signature, body.razorpay_order_id);
  }

  // Helper: Validate customer ID from JWT matches param
  private validateCustomerId(req: any, customerId: string) {
    if (!req.customer || req.customer.customer_id !== customerId) {
      throw new ApiError('UNAUTHORIZED', 'You do not have access to this wallet', HttpStatus.FORBIDDEN);
    }
  }
}
