import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index('idx_cl_rider', ['rider_id', 'status'])
@Entity('commission_ledger')
export class CommissionLedger {
  @PrimaryGeneratedColumn('increment') id: number;
  @Column('bigint', { unique: true }) trip_payment_id: string;
  @Column('bigint') rider_id: string;
  @Column('bigint') rider_wallet_id: string;
  @Column('bigint') commission_amount: number;
  @Column({ length: 15 }) commission_type: string; // 'percentage', 'fixed', 'tiered'
  @Column({ nullable: true, type: 'integer' }) commission_rate?: number;
  @Column('bigint') fare_basis: number;
  @Column({ nullable: true, type: 'bigint' }) wallet_txn_id?: string;
  @Column({ length: 15, default: 'pending' }) status: string; // 'pending', 'deducted', 'waived', 'reversed'
  @Column({ length: 64, unique: true }) idempotency_key: string;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
  @Column({ nullable: true, type: 'timestamp' }) deducted_at?: Date;
}
