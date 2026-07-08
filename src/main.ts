import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bodyParser from 'body-parser';
import { AppModule } from './app.module';
import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { requestLoggerMiddleware } from './common/request-logger.middleware';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

loadEnv({ path: '.env.production', override: true });
loadEnv({ path: '.env', override: true });

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);
  
  // Add body parser middleware before other middleware
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
  
  app.use(requestLoggerMiddleware(config.get<string>('API_LOG_FILE') || './logs/api-requests.jsonl'));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors();
  await app.listen(config.get<number>('PORT') || 3000);
}

bootstrap();
