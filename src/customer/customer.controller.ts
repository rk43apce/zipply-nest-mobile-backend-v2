import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { CustomerAuthGuard } from './customer-auth.guard';
import { CustomerService } from './customer.service';

@Controller('customer')
export class CustomerController {
  constructor(private customers: CustomerService) {}
  @Post('otp/send') sendOtp(@Body('mobile') mobile: string) { return this.customers.sendOtp(mobile); }
  @Post('otp/verify') verifyOtp(@Body() body: any) { return this.customers.verifyOtp(body.mobile, body.otp); }
  @Post('token/refresh') refresh(@Body('refresh_token') token: string) { return this.customers.refresh(token); }
  @UseGuards(CustomerAuthGuard) @Get('profile') profile(@Req() req: any) { return this.customers.profile(req.customer.customer_id); }
  @UseGuards(CustomerAuthGuard) @Put('profile') updateProfile(@Req() req: any, @Body() body: any) { return this.customers.updateProfile(req.customer.customer_id, body); }
  @UseGuards(CustomerAuthGuard) @Get('addresses') addresses(@Req() req: any) { return this.customers.listAddresses(req.customer.customer_id); }
  @UseGuards(CustomerAuthGuard) @Post('addresses') addAddress(@Req() req: any, @Body() body: any) { return this.customers.addAddress(req.customer.customer_id, body); }
  @UseGuards(CustomerAuthGuard) @Put('addresses/:id') updateAddress(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.customers.updateAddress(req.customer.customer_id, id, body); }
  @UseGuards(CustomerAuthGuard) @Delete('addresses/:id') deleteAddress(@Req() req: any, @Param('id') id: string) { return this.customers.deleteAddress(req.customer.customer_id, id); }
}
