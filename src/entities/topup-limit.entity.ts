import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

@Unique(['wallet_id', 'period_type', 'period_key'])
@Index('idx_tlt_wallet', ['wallet_id'])
@Entity('topup_limits_tracker')
export class TopupLimitTracker {
  @PrimaryGeneratedColumn('increment') id: number;
  @Column('bigint') wallet_id: string;
  @Column({ length: 10 }) period_type: string; // 'daily', 'monthly'
  @Column({ length: 10 }) period_key: string; // YYYY-MM-DD or YYYY-MM
  @Column('bigint', { default: 0 }) total_amount: number;
  @Column({ default: 0 }) txn_count: number;
  @UpdateDateColumn({ type: 'timestamp' }) updated_at: Date;
}
