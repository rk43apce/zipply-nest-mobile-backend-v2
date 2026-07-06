import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { SessionService } from './session.service';
import { OtpRequest, Rider, UserActiveSession, DeviceFingerprint } from '../entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([OtpRequest, Rider, UserActiveSession, DeviceFingerprint]),
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET') || 'your-secret-key-256-bit-minimum',
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN') || '7d' }
      })
    })
  ],
  providers: [AuthService, JwtStrategy, SessionService],
  controllers: [AuthController],
  exports: [AuthService, SessionService]
})
export class AuthModule {}
