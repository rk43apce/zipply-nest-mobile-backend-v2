import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index('idx_rw_rider_status', ['rider_id', 'status'])
@Entity('rider_withdrawals')
export class RiderWithdrawal {
  @PrimaryGeneratedColumn('increment') id: number;
  @Column('bigint') rider_id: string;
  @Column('bigint') rider_wallet_id: string;
  @Column('bigint') amount: number;
  @Column({ length: 20 }) payout_method: string; // 'bank_transfer', 'upi'
  @Column({ nullable: true, length: 128 }) payout_reference?: string;
  @Column({ nullable: true, type: 'bigint' }) wallet_txn_id?: string;
  @Column({ length: 15, default: 'initiated' }) status: string; // 'initiated', 'processing', 'completed', 'failed', 'reversed'
  @Column({ nullable: true, length: 255 }) failure_reason?: string;
  @Column({ length: 64, unique: true }) idempotency_key: string;
  @CreateDateColumn({ type: 'timestamp' }) initiated_at: Date;
  @Column({ nullable: true, type: 'timestamp' }) completed_at?: Date;
  @Column({ nullable: true, type: 'timestamp' }) failed_at?: Date;
  @Column({ nullable: true, type: 'timestamp' }) reversed_at?: Date;
}
