import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Unique(['wallet_id', 'period_type', 'period_start'])
@Index('idx_tlt_wallet', ['wallet_id'])
@Entity('topup_limits_tracker')
export class TopupLimitTracker {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') wallet_id: string;
  @Column({ length: 10 }) period_type: string; // 'daily', 'monthly'
  @Column('date') period_start: Date; // Date for daily or YYYY-MM for monthly
  @Column({ type: 'integer', default: 0 }) amount_used: number;
}
