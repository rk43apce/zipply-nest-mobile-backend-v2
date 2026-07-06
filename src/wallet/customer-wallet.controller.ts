import { Body, Controller, Get, Param, Post, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiError } from '../common/api-error';
import { HttpStatus } from '@nestjs/common';
import { WalletService } from './wallet.service';

@Controller('customer/wallet')
@UseGuards(JwtAuthGuard)
export class CustomerWalletController {
  constructor(private wallet: WalletService) {}

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

  // Helper: Validate customer ID from JWT matches param
  private validateCustomerId(req: any, customerId: string) {
    if (!req.user || req.user.customer_id !== customerId) {
      throw new ApiError('UNAUTHORIZED', 'You do not have access to this wallet', HttpStatus.FORBIDDEN);
    }
  }
}
