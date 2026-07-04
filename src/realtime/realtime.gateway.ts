import { UseFilters } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { OrderDispatch } from '../entities';

@WebSocketGateway({ path: '/ws', cors: true })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;
  constructor(private jwt: JwtService, @InjectRepository(OrderDispatch) private dispatches: Repository<OrderDispatch>) {}

  async handleConnection(client: Socket) {
    try {
      const raw = client.handshake.auth?.token || '';
      const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
      const payload: any = this.jwt.verify(token);
      if (payload.type === 'customer' && payload.customer_id) {
        client.data.customer_id = payload.customer_id;
        await client.join(`customer:${payload.customer_id}`);
        return;
      }
      client.data.rider_id = payload.rider_id;
      await client.join(`rider:${payload.rider_id}`);
      const active = await this.dispatches.findOne({ where: { assigned_rider_id: payload.rider_id }, order: { assigned_at: 'DESC' } });
      if (active && !['delivered', 'cancelled', 'no_rider'].includes(active.status)) await client.join(`delivery:${active.order_id}`);
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage('ping')
  ping(@ConnectedSocket() client: Socket) {
    client.emit('pong', { at: new Date().toISOString() });
  }

  @SubscribeMessage('location_update')
  location(@ConnectedSocket() client: Socket, @MessageBody() body: any) {
    this.emitToRider(client.data.rider_id, 'location_ack', { updated_at: new Date().toISOString(), ...body });
  }

  emitToRider(riderId: string, event: string, payload: any) {
    this.server?.to(`rider:${riderId}`).emit(event, payload);
  }
  emitToCustomer(customerId: string, event: string, payload: any) {
    if (customerId) this.server?.to(`customer:${customerId}`).emit(event, payload);
  }
}
