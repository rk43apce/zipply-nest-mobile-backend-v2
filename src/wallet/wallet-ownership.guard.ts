import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wallet } from '../entities';

@Injectable()
export class WalletOwnershipGuard implements CanActivate {
  constructor(
    @InjectRepository(Wallet) private wallets: Repository<Wallet>
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const walletId = request.params.walletId;
    const riderId = request.params.riderId;

    if (!user || !user.rider_id) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    // If endpoint has walletId param, verify it belongs to the rider
    if (walletId) {
      const wallet = await this.wallets.findOne({ where: { id: walletId } });
      if (!wallet || wallet.user_id !== (user.rider_id as any)) {
        throw new HttpException('Wallet does not belong to this rider', HttpStatus.FORBIDDEN);
      }
    }

    // If endpoint has riderId param, verify it matches the JWT
    if (riderId && riderId !== user.rider_id) {
      throw new HttpException('Unauthorized: Rider ID mismatch', HttpStatus.FORBIDDEN);
    }

    return true;
  }
}
