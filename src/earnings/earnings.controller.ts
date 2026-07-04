import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { EarningsService } from './earnings.service';

@UseGuards(AuthGuard('jwt'))
@Controller('rider')
export class EarningsController {
  constructor(private earnings: EarningsService) {}
  @Get('earnings/summary') summary(@Query('rider_id') id: string) { return this.earnings.summary(id); }
  @Get('earnings') list(@Query('rider_id') id: string, @Query('period') period = 'week') { return this.earnings.list(id, period); }
  @Get('deliveries') deliveries(@Query() q: any) { return this.earnings.deliveries(q.rider_id, q.status || 'all', Number(q.page || 1), Number(q.limit || 20)); }
  @Get('deliveries/recent') recent(@Query('rider_id') id: string, @Query('limit') limit = '3') { return this.earnings.recent(id, Number(limit)); }
}
