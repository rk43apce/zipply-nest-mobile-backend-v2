import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('wallet_holds')
export class WalletHold {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') wallet_id: string;
  @Column() amount: number;
  @Column({ nullable: true, length: 255 }) reason?: string;
  @Column({ nullable: true, length: 30 }) reference_type?: string;
  @Column({ nullable: true, length: 100 }) reference_id?: string;
  @Column({ length: 20, default: 'active' }) status: string;
  @Column({ unique: true, length: 64 }) idempotency_key: string;
  @Column('uuid', { nullable: true }) capture_txn_id?: string;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
  @Column({ type: 'timestamp' }) expires_at: Date;
  @Column({ type: 'timestamp', nullable: true }) captured_at?: Date;
  @Column({ type: 'timestamp', nullable: true }) released_at?: Date;
}
