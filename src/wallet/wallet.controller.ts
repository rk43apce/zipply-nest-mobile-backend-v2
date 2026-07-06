import { Body, Controller, Get, Param, Post, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiError } from '../common/api-error';
import { HttpStatus } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { TopUpService } from './topup.service';
import { WithdrawalService } from './withdrawal.service';
import { CashPaymentService } from './cash-payment.service';
import { CommissionEngine } from './commission.engine';
import { BusinessRulesService } from './business-rules.service';

@Controller('rider/wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(
    private wallet: WalletService,
    private topup: TopUpService,
    private withdrawal: WithdrawalService,
    private cashPayment: CashPaymentService,
    private commission: CommissionEngine,
    private rules: BusinessRulesService
  ) {}

  // Get wallet balance
  @Get(':riderId')
  async getBalance(@Param('riderId') riderId: string, @Request() req: any) {
    this.validateRiderId(req, riderId);
    return await this.wallet.getWallet(riderId);
  }

  // Initiate top-up
  @Post(':riderId/topup/initiate')
  async initiateTopup(
    @Param('riderId') riderId: string,
    @Body() body: { amount: number; gateway?: string; idempotency_key: string },
    @Request() req: any
  ) {
    this.validateRiderId(req, riderId);
    if (!body.amount || !body.idempotency_key) {
      throw new ApiError('INVALID_REQUEST', 'amount and idempotency_key required', HttpStatus.BAD_REQUEST);
    }
    return await this.topup.initiateTopUp(riderId, body.amount, body.gateway || 'razorpay', body.idempotency_key);
  }

  // Confirm top-up
  @Post(':riderId/topup/confirm')
  async confirmTopup(
    @Param('riderId') riderId: string,
    @Body() body: { payment_txn_id: string; gateway_payment_id: string; gateway_signature: string },
    @Request() req: any
  ) {
    this.validateRiderId(req, riderId);
    if (!body.payment_txn_id || !body.gateway_payment_id || !body.gateway_signature) {
      throw new ApiError('INVALID_REQUEST', 'All payment fields required', HttpStatus.BAD_REQUEST);
    }
    return await this.topup.confirmTopUp(riderId, body.payment_txn_id, body.gateway_payment_id, body.gateway_signature);
  }

  // Get withdrawal info
  @Get(':riderId/withdraw/info')
  async getWithdrawInfo(@Param('riderId') riderId: string, @Request() req: any) {
    this.validateRiderId(req, riderId);
    return await this.withdrawal.getWithdrawInfo(riderId);
  }

  // Initiate withdrawal
  @Post(':riderId/withdraw')
  async initiateWithdrawal(
    @Param('riderId') riderId: string,
    @Body() body: { amount: number; payout_method: string; idempotency_key: string },
    @Request() req: any
  ) {
    this.validateRiderId(req, riderId);
    if (!body.amount || !body.payout_method || !body.idempotency_key) {
      throw new ApiError('INVALID_REQUEST', 'amount, payout_method, and idempotency_key required', HttpStatus.BAD_REQUEST);
    }
    return await this.withdrawal.initiateWithdrawal(riderId, body.amount, body.payout_method, body.idempotency_key);
  }

  // Get withdrawal status
  @Get(':riderId/withdraw/:withdrawalId')
  async getWithdrawalStatus(
    @Param('riderId') riderId: string,
    @Param('withdrawalId') withdrawalId: string,
    @Request() req: any
  ) {
    this.validateRiderId(req, riderId);
    return await this.withdrawal.getWithdrawalStatus(riderId, parseInt(withdrawalId));
  }

  // Get transactions
  @Get(':riderId/transactions')
  async getTransactions(
    @Param('riderId') riderId: string,
    @Request() req: any,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
    @Query('type') txnType?: string
  ) {
    this.validateRiderId(req, riderId);
    return await this.wallet.getTransactions(riderId, parseInt(page || '1'), parseInt(perPage || '20'), txnType);
  }

  // Get active cash trip
  @Get(':riderId/active-cash')
  async getActiveCashTrip(@Param('riderId') riderId: string, @Request() req: any) {
    this.validateRiderId(req, riderId);
    return await this.cashPayment.getActiveCashTrip(riderId);
  }

  // Confirm cash collection
  @Post(':riderId/:tripId/confirm-cash')
  async confirmCashCollection(
    @Param('riderId') riderId: string,
    @Param('tripId') tripId: string,
    @Body() body: { idempotency_key: string },
    @Request() req: any
  ) {
    this.validateRiderId(req, riderId);
    if (!body.idempotency_key) {
      throw new ApiError('IDEMPOTENCY_REQUIRED', 'idempotency_key required', HttpStatus.BAD_REQUEST);
    }
    return await this.cashPayment.confirmCashCollection(riderId, tripId, body.idempotency_key);
  }

  // Check rider eligibility
  @Get(':riderId/eligibility')
  async checkEligibility(@Param('riderId') riderId: string, @Request() req: any) {
    this.validateRiderId(req, riderId);
    return await this.wallet.checkRiderEligibility(riderId);
  }

  // ============ Admin Endpoints ============

  // Admin: Freeze wallet
  @Post('admin/freeze/:walletId')
  async freezeWallet(
    @Param('walletId') walletId: string,
    @Body() body: { reason?: string },
    @Request() req: any
  ) {
    // TODO: Add admin authorization check
    return await this.wallet.freezeWallet(walletId, body.reason);
  }

  // Admin: Unfreeze wallet
  @Post('admin/unfreeze/:walletId')
  async unfreezeWallet(@Param('walletId') walletId: string, @Request() req: any) {
    // TODO: Add admin authorization check
    return await this.wallet.unfreezeWallet(walletId);
  }

  // Admin: Get all business rules
  @Get('admin/business-rules')
  async getAllRules(@Request() req: any) {
    // TODO: Add admin authorization check
    return await this.rules.getAllRules();
  }

  // Admin: Get specific rule
  @Get('admin/business-rules/:key')
  async getRule(@Param('key') key: string, @Request() req: any) {
    // TODO: Add admin authorization check
    return await this.rules.getRuleByKey(key);
  }

  // Admin: Update rule
  @Post('admin/business-rules/:key')
  async updateRule(
    @Param('key') key: string,
    @Body() body: { rule_value: any; value_type?: string },
    @Request() req: any
  ) {
    // TODO: Add admin authorization check
    return await this.rules.updateRule(key, body.rule_value, body.value_type, 'admin');
  }

  // Helper: Validate rider ID from JWT matches param
  private validateRiderId(req: any, riderId: string) {
    if (!req.user || req.user.rider_id !== riderId) {
      throw new ApiError('UNAUTHORIZED', 'You do not have access to this wallet', HttpStatus.FORBIDDEN);
    }
  }
}
