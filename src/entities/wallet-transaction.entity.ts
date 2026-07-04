import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index('idx_wallet_txn_wallet_created', ['wallet_id', 'created_at'])
@Entity('wallet_transactions')
export class WalletTransaction {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') wallet_id: string;
  @Column({ length: 10 }) txn_type: string;
  @Column({ length: 30 }) txn_category: string;
  @Column() amount: number;
  @Column() running_balance: number;
  @Column({ nullable: true, length: 255 }) description?: string;
  @Column({ length: 20, default: 'completed' }) status: string;
  @Column({ nullable: true, length: 30 }) reference_type?: string;
  @Column({ nullable: true, length: 100 }) reference_id?: string;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
}
