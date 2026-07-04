import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CustomerAuthGuard } from '../customer/customer-auth.guard';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private orders: OrdersService) {}
  @Post('estimate') estimate(@Body() body: any) { return this.orders.estimate(body); }
  @UseGuards(CustomerAuthGuard) @Post('create') create(@Req() req: any, @Body() body: any) { return this.orders.create(req.customer.customer_id, body); }
  @UseGuards(CustomerAuthGuard) @Post(':orderId/online/confirm') confirmOnline(@Param('orderId') orderId: string) { return this.orders.confirmOnlinePayment(orderId); }
  @UseGuards(CustomerAuthGuard) @Get() list(@Req() req: any, @Query() q: any) { return this.orders.list(req.customer.customer_id, Number(q.page || 1), Number(q.limit || 20), q.status); }
  @UseGuards(CustomerAuthGuard) @Get(':orderId/status') status(@Req() req: any, @Param('orderId') orderId: string) { return this.orders.status(req.customer.customer_id, orderId); }
  @UseGuards(CustomerAuthGuard) @Get(':orderId/timeline') timeline(@Req() req: any, @Param('orderId') orderId: string) { return this.orders.timeline(req.customer.customer_id, orderId); }
  @UseGuards(CustomerAuthGuard) @Get(':orderId') get(@Req() req: any, @Param('orderId') orderId: string) { return this.orders.get(req.customer.customer_id, orderId); }
  @UseGuards(CustomerAuthGuard) @Post(':orderId/cancel') cancel(@Req() req: any, @Param('orderId') orderId: string, @Body() body: any) { return this.orders.cancel(req.customer.customer_id, orderId, body.reason); }
  @UseGuards(CustomerAuthGuard) @Post(':orderId/rate') rate(@Req() req: any, @Param('orderId') orderId: string, @Body() body: any) { return this.orders.rate(req.customer.customer_id, orderId, body); }
}
