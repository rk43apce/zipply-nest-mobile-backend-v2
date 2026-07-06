import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index('idx_wallet_txn_wallet_created', ['wallet_id', 'created_at'])
@Index('idx_wt_wallet_status', ['wallet_id', 'status'])
@Index('idx_wt_reference', ['reference_type', 'reference_id'])
@Entity('wallet_transactions')
export class WalletTransaction {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') wallet_id: string;
  @Column({ length: 64, unique: true }) idempotency_key: string;
  @Column({ length: 10 }) txn_type: string; // 'credit', 'debit'
  @Column({ length: 30 }) txn_category: string; // 'topup', 'purchase', 'refund', 'reversal', 'hold_capture', 'hold_release', 'bonus', 'expiry'
  @Column('bigint') amount: number;
  @Column('bigint') running_balance: number;
  @Column({ nullable: true, length: 50 }) reference_type?: string;
  @Column({ nullable: true, length: 64 }) reference_id?: string;
  @Column({ nullable: true, length: 255 }) description?: string;
  @Column({ length: 15, default: 'pending' }) status: string; // 'pending', 'completed', 'failed', 'reversed'
  @Column({ type: 'jsonb', nullable: true }) metadata?: Record<string, any>;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
  @Column({ nullable: true, type: 'timestamp' }) completed_at?: Date;
}
