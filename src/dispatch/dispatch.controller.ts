import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DispatchService } from './dispatch.service';

@UseGuards(AuthGuard('jwt'))
@Controller('dispatch')
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}
  @Post('online') online(@Body() b: any) { return this.dispatch.online(b); }
  @Post('offline') offline(@Body() b: any) { return this.dispatch.offline(b.rider_id); }
  @Post('location') location(@Body() b: any) { return this.dispatch.location(b); }
  @Post('start') start(@Body() b: any) { return this.dispatch.start(b); }
  @Post('accept') accept(@Body() b: any) { return this.dispatch.accept(b.offer_id, b.rider_id); }
  @Post('reject') reject(@Body() b: any) { return this.dispatch.reject(b.offer_id, b.rider_id, b.reason); }
  @Post('en-route-pickup') enRoute(@Body() b: any) { return this.dispatch.transition(b.order_id, b.rider_id, 'assigned', 'en_route_pickup'); }
  @Post('arrived-pickup') arrived(@Body() b: any) { return this.dispatch.transition(b.order_id, b.rider_id, ['assigned', 'en_route_pickup'], 'arrived_pickup'); }
  @Post('picked-up') picked(@Body() b: any) { return this.dispatch.transition(b.order_id, b.rider_id, 'arrived_pickup', 'picked_up'); }
  @Post('in-transit') transit(@Body() b: any) { return this.dispatch.transition(b.order_id, b.rider_id, 'picked_up', 'in_transit'); }
  @Post('cancel-pickup') cancel(@Body() b: any) { return this.dispatch.cancelPickup(b); }
  @Post('delivered') delivered(@Body() b: any) { return this.dispatch.delivered(b); }
  @Get('current-offer') currentOffer(@Query('rider_id') riderId: string) { return this.dispatch.currentOffer(riderId); }
  @Get('status') status(@Query('rider_id') riderId: string) { return this.dispatch.status(riderId); }
}
