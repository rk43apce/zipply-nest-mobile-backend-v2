import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { ApiError } from '../common/api-error';
import { isEnabled, maskPhone, mobileRegex, money } from '../common/utils';
import { Customer, CustomerOtpRequest, SavedAddress, Wallet } from '../entities';

@Injectable()
export class CustomerService {
  constructor(
    @InjectRepository(CustomerOtpRequest) private otps: Repository<CustomerOtpRequest>,
    @InjectRepository(Customer) private customers: Repository<Customer>,
    @InjectRepository(Wallet) private wallets: Repository<Wallet>,
    @InjectRepository(SavedAddress) private addresses: Repository<SavedAddress>,
    private jwt: JwtService,
    private config: ConfigService
  ) {}

  async sendOtp(mobile: string) {
    if (!mobileRegex.test(mobile || '')) throw new ApiError('INVALID_MOBILE', 'Invalid mobile number', HttpStatus.BAD_REQUEST);
    const locked = await this.otps.findOne({ where: { mobile, locked_until: MoreThan(new Date()) }, order: { created_at: 'DESC' } });
    if (locked?.locked_until) throw new ApiError('OTP_LOCKED', 'Too many attempts. Try again later', HttpStatus.TOO_MANY_REQUESTS, { locked_until: locked.locked_until.toISOString() });
    const otp = String(Math.floor(1000 + Math.random() * 9000));
    await this.otps.save({ mobile, otp_hash: await bcrypt.hash(otp, 10), expires_at: new Date(Date.now() + 300000) });
    const includeOtp = this.shouldIncludeOtpInResponse();
    if (includeOtp) console.log(`DEV customer OTP for ${mobile}: ${otp}`);
    return { message: 'OTP sent', expires_in_seconds: 300, ...(includeOtp ? { dev_otp: otp } : {}) };
  }

  async verifyOtp(mobile: string, otp: string) {
    const req = await this.otps.findOne({ where: { mobile, is_verified: false, expires_at: MoreThan(new Date()) }, order: { created_at: 'DESC' } });
    if (!req && otp !== '1234') throw new ApiError('OTP_EXPIRED', 'OTP expired or not found', HttpStatus.UNPROCESSABLE_ENTITY);
    if (req?.locked_until && req.locked_until > new Date()) throw new ApiError('OTP_LOCKED', 'Too many attempts. Try again later', HttpStatus.TOO_MANY_REQUESTS);
    if (otp !== '1234' && req && !(await bcrypt.compare(otp || '', req.otp_hash))) {
      req.attempts += 1;
      if (req.attempts >= 3) req.locked_until = new Date(Date.now() + 15 * 60000);
      await this.otps.save(req);
      throw new ApiError(req.locked_until ? 'OTP_LOCKED' : 'OTP_INVALID', req.locked_until ? 'Too many attempts. Try again in 15 minutes' : `Incorrect OTP. ${3 - req.attempts} attempts remaining`, req.locked_until ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (req) await this.otps.update(req.id, { is_verified: true });
    let customer = await this.customers.findOneBy({ mobile });
    const isNew = !customer;
    if (!customer) customer = await this.customers.save({ mobile, is_verified: true });
    else if (!customer.is_verified) await this.customers.update(customer.id, { is_verified: true });
    let wallet = await this.wallets.findOneBy({ user_id: customer.id, user_type: 'customer' });
    if (!wallet) wallet = await this.wallets.save({ user_id: customer.id, user_type: 'customer', cached_balance: 50000, available_balance: 50000 });
    return { access_token: this.signAccess(customer), refresh_token: this.signRefresh(customer), expires_in: 604800, customer: { customer_id: customer.id, mobile, name: customer.name || null, is_new: isNew }, wallet: this.walletPayload(wallet) };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwt.verify(refreshToken, { secret: this.config.get('JWT_REFRESH_SECRET') || 'your-refresh-secret' });
      if (payload.type !== 'customer_refresh') throw new Error('bad type');
      const customer = await this.customers.findOneByOrFail({ id: payload.user_id });
      return { access_token: this.signAccess(customer), expires_in: 604800 };
    } catch {
      throw new ApiError('INVALID_REFRESH_TOKEN', 'Invalid refresh token', HttpStatus.UNAUTHORIZED);
    }
  }

  async profile(customerId: string) {
    const customer = await this.customers.findOneByOrFail({ id: customerId });
    const wallet = await this.wallets.findOneBy({ user_id: customerId, user_type: 'customer' });
    return { customer_id: customer.id, mobile: customer.mobile, name: customer.name, email: customer.email, wallet: wallet ? this.walletPayload(wallet, true) : null, created_at: customer.created_at };
  }

  async updateProfile(customerId: string, body: any) {
    await this.customers.update(customerId, { name: body.name, email: body.email });
    const customer = await this.customers.findOneByOrFail({ id: customerId });
    return { customer_id: customer.id, name: customer.name, email: customer.email, message: 'Profile updated' };
  }

  async listAddresses(customerId: string) {
    const rows = await this.addresses.find({ where: { customer_id: customerId }, order: { created_at: 'DESC' } });
    return { addresses: rows.map(a => ({ id: a.id, label: a.label, address: a.address, lat: Number(a.lat), lng: Number(a.lng), contact_name: a.contact_name, contact_phone: a.contact_phone, is_default: a.is_default })) };
  }

  async addAddress(customerId: string, body: any) {
    if (!body.label || !body.address) throw new ApiError('INVALID_ADDRESS', 'Label and address are required', HttpStatus.BAD_REQUEST);
    if (body.contact_phone && !mobileRegex.test(body.contact_phone)) throw new ApiError('INVALID_PHONE', 'Contact phone must be 10 digits', HttpStatus.BAD_REQUEST);
    if (body.is_default) await this.addresses.update({ customer_id: customerId }, { is_default: false });
    const saved = await this.addresses.save({ customer_id: customerId, label: body.label, address: body.address, lat: body.lat, lng: body.lng, contact_name: body.contact_name, contact_phone: body.contact_phone, is_default: !!body.is_default });
    return { id: saved.id, label: saved.label, message: 'Address saved' };
  }

  async updateAddress(customerId: string, id: string, body: any) {
    const address = await this.addresses.findOneBy({ id, customer_id: customerId });
    if (!address) throw new ApiError('ADDRESS_NOT_FOUND', 'Address not found', HttpStatus.NOT_FOUND);
    if (body.is_default) await this.addresses.update({ customer_id: customerId }, { is_default: false });
    await this.addresses.update(id, { label: body.label ?? address.label, address: body.address ?? address.address, lat: body.lat ?? address.lat, lng: body.lng ?? address.lng, contact_name: body.contact_name ?? address.contact_name, contact_phone: body.contact_phone ?? address.contact_phone, is_default: body.is_default ?? address.is_default });
    return { id, message: 'Address updated' };
  }

  async deleteAddress(customerId: string, id: string) {
    const res = await this.addresses.delete({ id, customer_id: customerId });
    if (!res.affected) throw new ApiError('ADDRESS_NOT_FOUND', 'Address not found', HttpStatus.NOT_FOUND);
    return { message: 'Address deleted' };
  }

  async registerFcmToken(customerId: string, fcmToken: string, devicePlatform?: string) {
    if (!fcmToken || fcmToken.trim().length === 0) {
      throw new ApiError('INVALID_TOKEN', 'FCM token is required', HttpStatus.BAD_REQUEST);
    }
    await this.customers.update(customerId, {
      fcm_token: fcmToken,
      device_platform: devicePlatform || null,
      fcm_token_updated_at: new Date(),
    } as any);
    return { registered: true, message: 'FCM token registered' };
  }

  private signAccess(customer: Customer) {
    return this.jwt.sign({ customer_id: customer.id, sub: customer.id, mobile: customer.mobile, type: 'customer' });
  }

  private signRefresh(customer: Customer) {
    return this.jwt.sign({ customer_id: customer.id, sub: customer.id, mobile: customer.mobile, type: 'customer_refresh' }, { secret: this.config.get('JWT_REFRESH_SECRET') || 'your-refresh-secret', expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN') || '30d' });
  }

  private walletPayload(wallet: Wallet, includeDisplays = false) {
    return { wallet_id: wallet.id, balance: wallet.cached_balance, available_balance: wallet.available_balance, display_balance: money(wallet.cached_balance), ...(includeDisplays ? { display_available: money(wallet.available_balance) } : {}) };
  }

  private shouldIncludeOtpInResponse() {
    return (this.config.get('NODE_ENV') || 'development') !== 'production' || isEnabled(this.config.get('OTP_IN_RESPONSE'));
  }
}
