import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

export const REDIS = Symbol('REDIS');

export const redisProvider = {
  provide: REDIS,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => new Redis(config.get('REDIS_URL') || 'redis://localhost:6379', { maxRetriesPerRequest: null })
};
