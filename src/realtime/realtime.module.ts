import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { RealtimeGateway } from './realtime.gateway';
import { OrderDispatch } from '../entities';

@Module({
  imports: [TypeOrmModule.forFeature([OrderDispatch]), JwtModule.registerAsync({ inject: [ConfigService], useFactory: (c: ConfigService) => ({ secret: c.get('JWT_SECRET') || 'your-secret-key-256-bit-minimum' }) })],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway]
})
export class RealtimeModule {}
