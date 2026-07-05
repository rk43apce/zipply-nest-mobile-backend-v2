import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { ApiError } from '../common/api-error';
import { isEnabled, mobileRegex } from '../common/utils';
import { OtpRequest, Rider } from '../entities';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(OtpRequest) private readonly otps: Repository<OtpRequest>,
    @InjectRepository(Rider) private readonly riders: Repository<Rider>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService
  ) {}

  async sendOtp(mobile: string) {
    if (!mobileRegex.test(mobile || '')) throw new ApiError('INVALID_MOBILE', 'Invalid mobile number', HttpStatus.BAD_REQUEST);
    const locked = await this.otps.findOne({ where: { mobile, locked_until: MoreThan(new Date()) }, order: { created_at: 'DESC' } });
    if (locked?.locked_until) {
      const minutes = Math.ceil((locked.locked_until.getTime() - Date.now()) / 60000);
      throw new ApiError('OTP_LOCKED', `Too many attempts. Try again in ${minutes} minutes`, HttpStatus.TOO_MANY_REQUESTS, { locked_until: locked.locked_until.toISOString() });
    }
    const otp = String(Math.floor(1000 + Math.random() * 9000));
    await this.otps.save({ mobile, otp_hash: await bcrypt.hash(otp, 10), expires_at: new Date(Date.now() + 300000) });
    const includeOtp = this.shouldIncludeOtpInResponse();
    if (includeOtp) console.log(`DEV OTP for ${mobile}: ${otp}`);
    return { message: 'OTP sent successfully', expires_in_seconds: 300, ...(includeOtp ? { dev_otp: otp } : {}) };
  }

  async verifyOtp(mobile: string, otp: string) {
    const req = await this.otps.findOne({ where: { mobile, is_verified: false, expires_at: MoreThan(new Date()) }, order: { created_at: 'DESC' } });
    if (!req) throw new ApiError('OTP_EXPIRED', 'OTP expired or not found', HttpStatus.UNPROCESSABLE_ENTITY);
    if (req.locked_until && req.locked_until > new Date()) throw new ApiError('OTP_LOCKED', 'Too many attempts. Try again later', HttpStatus.TOO_MANY_REQUESTS, { locked_until: req.locked_until.toISOString() });
    if (!(await bcrypt.compare(otp || '', req.otp_hash))) {
      req.attempts += 1;
      if (req.attempts >= 3) req.locked_until = new Date(Date.now() + 15 * 60000);
      await this.otps.save(req);
      if (req.locked_until) throw new ApiError('OTP_LOCKED', 'Too many attempts. Try again in 15 minutes', HttpStatus.TOO_MANY_REQUESTS, { locked_until: req.locked_until.toISOString() });
      throw new ApiError('OTP_INVALID', `Incorrect OTP. ${3 - req.attempts} attempts remaining`, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    req.is_verified = true;
    await this.otps.save(req);
    let rider = await this.riders.findOne({ where: { mobile } });
    const isNew = !rider;
    if (!rider) rider = await this.riders.save({ mobile, onboarding_status: 'registered' });
    return {
      access_token: this.signAccess(rider),
      refresh_token: this.jwt.sign({ rider_id: rider.id, mobile, type: 'refresh' }, { secret: this.config.get('JWT_REFRESH_SECRET') || 'your-refresh-secret', expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN') || '30d' }),
      expires_in: 604800,
      rider: { rider_id: rider.id, mobile, name: rider.name || null, onboarding_status: rider.onboarding_status, is_new: isNew }
    };
  }

  async refresh(token: string) {
    try {
      const payload = this.jwt.verify(token, { secret: this.config.get('JWT_REFRESH_SECRET') || 'your-refresh-secret' });
      const rider = await this.riders.findOneByOrFail({ id: payload.rider_id });
      return { access_token: this.signAccess(rider), expires_in: 604800 };
    } catch {
      throw new ApiError('INVALID_REFRESH_TOKEN', 'Invalid refresh token', HttpStatus.UNAUTHORIZED);
    }
  }

  signAccess(rider: Rider) {
    return this.jwt.sign({ rider_id: rider.id, mobile: rider.mobile, onboarding_status: rider.onboarding_status });
  }

  private shouldIncludeOtpInResponse() {
    return (this.config.get('NODE_ENV') || 'development') !== 'production' || isEnabled(this.config.get('OTP_IN_RESPONSE'));
  }
}
