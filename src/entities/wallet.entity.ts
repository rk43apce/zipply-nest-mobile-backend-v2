import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn, Unique } from 'typeorm';

@Index('idx_wallets_status', ['status'])
@Index('idx_wallets_user', ['user_id'])
@Unique('wallets_user_id_user_type_key', ['user_id', 'user_type'])
@Entity('wallets')
export class Wallet {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') user_id: string;
  @Column({ length: 10, default: 'rider' }) user_type: string; // 'rider' or 'customer'
  @Column({ length: 3, default: 'INR' }) currency_code: string;
  @Column({ default: 0 }) cached_balance: number;
  @Column({ default: 0 }) available_balance: number;
  @Column({ length: 10, default: 'active' }) status: string; // 'active', 'frozen', 'closed'
  @Column({ default: 0 }) version: number;
  @Column({ default: 1000000 }) daily_topup_limit: number;
  @Column({ default: 10000000 }) monthly_topup_limit: number;
  @Column({ length: 10, default: 'basic' }) kyc_level: string; // 'basic', 'full'
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamp' }) updated_at: Date;
  @Column({ nullable: true, type: 'timestamp' }) closed_at?: Date;
}
