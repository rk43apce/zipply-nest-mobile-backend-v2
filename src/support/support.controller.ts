import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SupportService } from './support.service';

@Controller('rider/support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private support: SupportService) {}

  @Post('tickets')
  create(@Request() req: any, @Body() body: any) {
    return this.support.create(req.user.rider_id, body);
  }

  @Get('tickets')
  list(@Request() req: any) {
    return this.support.list(req.user.rider_id);
  }
}
