import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index('idx_wh_wallet_active', ['wallet_id', 'status'])
@Index('idx_wh_expires', ['status', 'expires_at'])
@Entity('wallet_holds')
export class WalletHold {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') wallet_id: string;
  @Column({ length: 64, unique: true }) idempotency_key: string;
  @Column('bigint') amount: number;
  @Column({ length: 255 }) reason: string;
  @Column({ nullable: true, length: 50 }) reference_type?: string;
  @Column({ nullable: true, length: 64 }) reference_id?: string;
  @Column({ length: 10, default: 'active' }) status: string; // 'active', 'captured', 'released', 'expired'
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
  @Column({ type: 'timestamp' }) expires_at: Date;
  @Column({ nullable: true, type: 'timestamp' }) captured_at?: Date;
  @Column({ nullable: true, type: 'timestamp' }) released_at?: Date;
  @Column({ nullable: true }) capture_txn_id?: string;
}
