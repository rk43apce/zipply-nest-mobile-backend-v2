import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('wallets')
export class Wallet {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { unique: true }) customer_id: string;
  @Column({ length: 3, default: 'INR' }) currency_code: string;
  @Column({ default: 0 }) cached_balance: number;
  @Column({ default: 0 }) available_balance: number;
  @Column({ length: 20, default: 'active' }) status: string;
  @Column({ default: 0 }) version: number;
  @Column({ default: 1000000 }) daily_topup_limit: number;
  @Column({ default: 10000000 }) monthly_topup_limit: number;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamp' }) updated_at: Date;
}
