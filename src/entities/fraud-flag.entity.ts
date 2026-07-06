import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index('idx_ff_user', ['user_id', 'user_type'])
@Index('idx_ff_status', ['status', 'severity'])
@Entity('fraud_flags')
export class FraudFlag {
  @PrimaryGeneratedColumn('increment') id: number;
  @Column({ nullable: true, type: 'bigint' }) wallet_id?: string;
  @Column('bigint') user_id: string;
  @Column({ length: 10 }) user_type: string; // 'customer', 'rider'
  @Column({ length: 30 }) flag_type: string; // 'velocity_breach', 'excessive_cash_trips', 'pattern_anomaly', 'manual'
  @Column({ length: 10, default: 'medium' }) severity: string; // 'low', 'medium', 'high', 'critical'
  @Column('text') description: string;
  @Column({ length: 15, default: 'open' }) status: string; // 'open', 'investigating', 'resolved', 'dismissed'
  @Column({ nullable: true, length: 64 }) resolved_by?: string;
  @Column({ nullable: true, type: 'timestamp' }) resolved_at?: Date;
  @Column({ nullable: true, type: 'text' }) resolution_notes?: string;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
}
