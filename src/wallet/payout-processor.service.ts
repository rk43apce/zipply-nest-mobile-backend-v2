import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { RiderWithdrawal } from '../entities';
import { WithdrawalService } from './withdrawal.service';

export interface PayoutResult {
  payout_id: string;
  status: 'processed' | 'failed' | 'queued';
  utr?: string; // Unique Transaction Reference (bank reference)
  failure_reason?: string;
}

@Injectable()
export class PayoutProcessorService {
  private readonly logger = new Logger(PayoutProcessorService.name);
  private readonly isMockMode: boolean;
  private readonly mockDelayMs: number;

  constructor(
    private config: ConfigService,
    private withdrawalService: WithdrawalService,
    @InjectRepository(RiderWithdrawal) private withdrawals: Repository<RiderWithdrawal>,
  ) {
    this.isMockMode = !this.config.get('RAZORPAY_PAYOUT_API_KEY');
    this.mockDelayMs = parseInt(this.config.get('MOCK_PAYOUT_DELAY_MS') || '3000', 10);

    if (this.isMockMode) {
      this.logger.warn('Payout processor running in MOCK mode - no real payouts will be processed');
    }
  }

  /**
   * Process a pending withdrawal by sending payout via Razorpay (or mock)
   * Called after withdrawal is initiated and wallet is debited.
   */
  async processPayout(withdrawalId: number): Promise<PayoutResult> {
    const withdrawal = await this.withdrawals.findOne({ where: { id: withdrawalId } });
    if (!withdrawal) {
      return { payout_id: '', status: 'failed', failure_reason: 'withdrawal_not_found' };
    }

    if (withdrawal.status !== 'processing') {
      this.logger.warn(`[PAYOUT] Withdrawal ${withdrawalId} not in processing state: ${withdrawal.status}`);
      return { payout_id: '', status: 'failed', failure_reason: `invalid_state_${withdrawal.status}` };
    }

    if (this.isMockMode) {
      return this.mockProcessPayout(withdrawal);
    }

    // Production: Call Razorpay Payout API
    // return this.realProcessPayout(withdrawal);

    // For now, always use mock
    return this.mockProcessPayout(withdrawal);
  }

  /**
   * Mock payout: Simulates a successful payout after a short delay.
   * 90% success rate in mock mode to test both success and failure paths.
   */
  private async mockProcessPayout(withdrawal: RiderWithdrawal): Promise<PayoutResult> {
    this.logger.log(`[MOCK_PAYOUT] Processing withdrawal ${withdrawal.id} for ₹${withdrawal.amount / 100}`);

    // Simulate network delay
    await this.delay(this.mockDelayMs);

    // 90% success rate for realistic testing
    const isSuccess = Math.random() < 0.9;

    if (isSuccess) {
      const payoutId = `pout_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const utr = `UTR${Date.now()}${Math.floor(Math.random() * 10000)}`;

      // Mark withdrawal as completed
      await this.withdrawalService.completeWithdrawal(withdrawal.id);

      // Update withdrawal with payout reference
      await this.withdrawals.update(withdrawal.id, {
        metadata: {
          ...(withdrawal.metadata || {}),
          payout_id: payoutId,
          utr,
          payout_mode: 'mock',
          processed_at: new Date().toISOString(),
        } as any,
      });

      this.logger.log(`[MOCK_PAYOUT] Success: withdrawal ${withdrawal.id}, payout ${payoutId}, UTR ${utr}`);

      return { payout_id: payoutId, status: 'processed', utr };
    } else {
      const failureReason = 'mock_payout_failure: beneficiary_account_invalid';

      // Mark withdrawal as failed (this reverses the wallet debit)
      await this.withdrawalService.failWithdrawal(withdrawal.id, failureReason);

      this.logger.log(`[MOCK_PAYOUT] Failed: withdrawal ${withdrawal.id}, reason: ${failureReason}`);

      return { payout_id: '', status: 'failed', failure_reason: failureReason };
    }
  }

  /**
   * Process all pending withdrawals (batch processor)
   * Can be called by a cron job or admin trigger.
   */
  async processAllPending(): Promise<{ processed: number; failed: number; results: PayoutResult[] }> {
    const pending = await this.withdrawals.find({ where: { status: 'processing' as any } });
    this.logger.log(`[PAYOUT_BATCH] Found ${pending.length} pending withdrawals to process`);

    const results: PayoutResult[] = [];
    let processed = 0;
    let failed = 0;

    for (const withdrawal of pending) {
      try {
        const result = await this.processPayout(withdrawal.id);
        results.push(result);
        if (result.status === 'processed') processed++;
        else if (result.status === 'failed') failed++;
      } catch (error) {
        this.logger.error(`[PAYOUT_BATCH] Error processing withdrawal ${withdrawal.id}:`, error);
        failed++;
        results.push({ payout_id: '', status: 'failed', failure_reason: error.message });
      }
    }

    this.logger.log(`[PAYOUT_BATCH] Complete: ${processed} processed, ${failed} failed`);
    return { processed, failed, results };
  }

  /**
   * Get payout status for a withdrawal (mock or real)
   */
  async getPayoutStatus(withdrawalId: number): Promise<{ status: string; utr?: string; payout_id?: string }> {
    const withdrawal = await this.withdrawals.findOne({ where: { id: withdrawalId } });
    if (!withdrawal) {
      return { status: 'not_found' };
    }

    const metadata = withdrawal.metadata as any;
    return {
      status: withdrawal.status,
      utr: metadata?.utr,
      payout_id: metadata?.payout_id,
    };
  }

  isMock(): boolean {
    return this.isMockMode;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
