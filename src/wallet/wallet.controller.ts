import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { WalletService } from './wallet.service';

@Controller('wallet')
export class WalletController {
  constructor(private wallets: WalletService) {}
  @Get(':walletId') get(@Param('walletId') walletId: string) { return this.wallets.get(walletId); }
  @Get(':walletId/limits') limits(@Param('walletId') walletId: string) { return this.wallets.getLimits(walletId); }
  @Post('topup/initiate') initiate(@Body() body: any) { return this.wallets.initiateTopup(body); }
  @Post('topup/confirm') confirm(@Body() body: any) { return this.wallets.confirmTopup(body.payment_txn_id, body); }
  @Post('topup/simulate/:paymentTxnId/success') simulateSuccess(@Param('paymentTxnId') id: string, @Body() body: any) { return this.wallets.confirmTopup(id, body); }
  @Post('topup/simulate/:paymentTxnId/failure') simulateFailure(@Param('paymentTxnId') id: string, @Body() body: any) { return this.wallets.failTopup(id, body); }
  @Post('topup/webhook/razorpay') webhook(@Body() body: any) { return this.wallets.handleRazorpayWebhook(body); }
  @Get('topup/:paymentTxnId') payment(@Param('paymentTxnId') id: string) { return this.wallets.payment(id); }
  @Get(':walletId/transactions') transactions(@Param('walletId') walletId: string, @Query() q: any) { return this.wallets.transactions(walletId, Number(q.page || 1), Number(q.limit || 20), q.txn_type); }
}
