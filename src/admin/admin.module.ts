import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { redisProvider } from '../common/redis.provider';
import { Rider, UserActiveSession } from '../entities';

@Module({
  imports: [TypeOrmModule.forFeature([Rider, UserActiveSession])],
  providers: [AdminService, redisProvider],
  controllers: [AdminController],
})
export class AdminModule {}
