import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WalletTransaction, PaymentTransaction, RiderWithdrawal, CommissionLedger } from '../entities';

@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  private idempotencyCache = new Map<string, { response: any; timestamp: number }>();
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  constructor(
    @InjectRepository(WalletTransaction) private txns: Repository<WalletTransaction>,
    @InjectRepository(PaymentTransaction) private payments: Repository<PaymentTransaction>,
    @InjectRepository(RiderWithdrawal) private withdrawals: Repository<RiderWithdrawal>,
    @InjectRepository(CommissionLedger) private commissions: Repository<CommissionLedger>
  ) {
    // Periodically clean up old cache entries
    setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.idempotencyCache.entries()) {
        if (now - value.timestamp > this.CACHE_TTL) {
          this.idempotencyCache.delete(key);
        }
      }
    }, 60 * 60 * 1000); // Every hour
  }

  async use(req: Request, res: Response, next: NextFunction) {
    // Only check POST/PUT requests
    if (!['POST', 'PUT'].includes(req.method)) {
      return next();
    }

    const idempotencyKey = req.headers['x-idempotency-key'] || req.body?.idempotency_key;
    if (!idempotencyKey) {
      return next();
    }

    const cacheKey = `${req.user?.['rider_id']}_${idempotencyKey}`;

    // Check in-memory cache first
    const cached = this.idempotencyCache.get(cacheKey);
    if (cached) {
      return res.status(200).json(cached.response);
    }

    // Check database for previous execution
    const dbRecord = await this.findIdempotencyRecord(idempotencyKey as string);
    if (dbRecord) {
      this.idempotencyCache.set(cacheKey, { response: dbRecord, timestamp: Date.now() });
      return res.status(200).json(dbRecord);
    }

    // Intercept response to cache it
    const originalJson = res.json.bind(res);
    res.json = function (body: any) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        this.idempotencyCache.set(cacheKey, { response: body, timestamp: Date.now() });
      }
      return originalJson(body);
    };

    next();
  }

  private async findIdempotencyRecord(key: string): Promise<any> {
    // Check all transaction tables for the idempotency key
    const txn = await this.txns.findOne({ where: { idempotency_key: key } });
    if (txn) {
      return {
        txn_id: txn.id,
        status: txn.status,
        running_balance: txn.running_balance
      };
    }

    const payment = await this.payments.findOne({ where: { idempotency_key: key } });
    if (payment) {
      return {
        payment_txn_id: payment.id,
        status: payment.status
      };
    }

    const withdrawal = await this.withdrawals.findOne({ where: { idempotency_key: key } });
    if (withdrawal) {
      return {
        withdrawal_id: withdrawal.id,
        status: withdrawal.status
      };
    }

    const commission = await this.commissions.findOne({ where: { idempotency_key: key } });
    if (commission) {
      return {
        commission_id: commission.id,
        status: commission.status
      };
    }

    return null;
  }
}
