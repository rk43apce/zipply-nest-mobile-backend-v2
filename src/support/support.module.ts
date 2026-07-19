import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderDispatch, SupportTicket } from '../entities';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [TypeOrmModule.forFeature([SupportTicket, OrderDispatch])],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
