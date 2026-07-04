import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ApiError } from '../common/api-error';

@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private config: ConfigService) {}

  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) throw new ApiError('UNAUTHORIZED', 'Customer token is required', HttpStatus.UNAUTHORIZED);
    try {
      const payload = this.jwt.verify(token, { secret: this.config.get('JWT_SECRET') || 'your-secret-key-256-bit-minimum' });
      if (payload.type !== 'customer' || !payload.customer_id) throw new Error('not customer');
      req.customer = payload;
      return true;
    } catch {
      throw new ApiError('UNAUTHORIZED', 'Invalid customer token', HttpStatus.UNAUTHORIZED);
    }
  }
}
