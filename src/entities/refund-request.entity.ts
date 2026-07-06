import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('refund_requests')
export class RefundRequest {
  @PrimaryGeneratedColumn('increment') id: number;
  @Column('bigint') wallet_id: string;
  @Column('bigint') original_payment_txn_id: string;
  @Column({ nullable: true, type: 'bigint' }) wallet_txn_id?: string;
  @Column('bigint') refund_amount: number;
  @Column('text') reason: string;
  @Column({ length: 15, default: 'initiated' }) status: string; // 'initiated', 'processing', 'completed', 'failed'
  @Column({ nullable: true, length: 128 }) gateway_refund_id?: string;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
  @Column({ nullable: true, type: 'timestamp' }) completed_at?: Date;
}
