import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('topup_limits_tracker')
@Unique(['wallet_id', 'period_type', 'period_start'])
export class TopupLimitTracker {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') wallet_id: string;
  @Column({ length: 10 }) period_type: string;
  @Column({ type: 'date' }) period_start: string;
  @Column({ default: 0 }) amount_used: number;
}
