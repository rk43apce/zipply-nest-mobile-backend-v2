import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index('idx_tl_payment_wallet', ['payment_txn_id', 'wallet_txn_id'])
@Entity('transaction_links')
export class TransactionLink {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() payment_txn_id: string;
  @Column() wallet_txn_id: string;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
}
