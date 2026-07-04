import { Logger, UseFilters } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { OrderDispatch } from '../entities';

@WebSocketGateway({ path: '/ws', cors: true })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

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
      this.logRealtime('rider_socket_joined', { rider_id: payload.rider_id, socket_id: client.id, room: `rider:${payload.rider_id}` });
      const active = await this.dispatches.findOne({ where: { assigned_rider_id: payload.rider_id }, order: { assigned_at: 'DESC' } });
      if (active && !['delivered', 'cancelled', 'no_rider'].includes(active.status)) await client.join(`delivery:${active.order_id}`);
    } catch {
      this.logRealtime('socket_connection_rejected', { socket_id: client.id });
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

  @SubscribeMessage('offer_received')
  offerReceived(@ConnectedSocket() client: Socket, @MessageBody() body: any) {
    this.logRealtime('rider_offer_ack_received', {
      rider_id: client.data.rider_id,
      socket_id: client.id,
      offer_id: body?.offer_id,
      order_id: body?.order_id,
      received_at: body?.received_at,
    });
  }

  emitToRider(riderId: string, event: string, payload: any) {
    const room = `rider:${riderId}`;
    const socketsInRoom = this.server?.sockets.adapter.rooms.get(room)?.size ?? 0;
    const emitted = this.server?.to(room).emit(event, payload) ?? false;
    this.logRealtime('rider_socket_emit', { rider_id: riderId, event, room, sockets_in_room: socketsInRoom, emitted });
    return { room, sockets_in_room: socketsInRoom, emitted };
  }
  emitToCustomer(customerId: string, event: string, payload: any) {
    if (customerId) this.server?.to(`customer:${customerId}`).emit(event, payload);
  }

  private logRealtime(event: string, data: Record<string, any>) {
    this.logger.log(JSON.stringify({ event, ...data }));
  }
}
