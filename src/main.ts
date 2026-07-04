import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { requestLoggerMiddleware } from './common/request-logger.middleware';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);
  app.use(requestLoggerMiddleware(config.get<string>('API_LOG_FILE') || './logs/api-requests.jsonl'));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors();
  await app.listen(config.get<number>('PORT') || 3000);
}

bootstrap();
