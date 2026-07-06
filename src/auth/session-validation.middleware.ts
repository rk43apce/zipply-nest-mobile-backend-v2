import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { SessionService } from './session.service';
import * as crypto from 'crypto';

@Injectable()
export class SessionValidationMiddleware implements NestMiddleware {
  constructor(private sessions: SessionService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // Skip session validation for auth endpoints
    if (req.path.startsWith('/auth') || req.path.startsWith('/api/auth')) {
      return next();
    }

    // Extract JWT token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(); // Let JWT guard handle this
    }

    const token = authHeader.substring(7);
    const user = req.user as any;

    if (!user || !user.rider_id) {
      return next(); // Not authenticated yet
    }

    // Validate session
    const tokenHash = this.getTokenHash(token);
    const isValidSession = await this.sessions.validateSession(String(user.rider_id), 'rider', tokenHash);

    if (!isValidSession) {
      throw new HttpException(
        { success: false, error: { code: 'FORCE_LOGOUT', message: 'Your account is now active on another device. Please login again to continue here.' } },
        HttpStatus.UNAUTHORIZED
      );
    }

    next();
  }

  private getTokenHash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
