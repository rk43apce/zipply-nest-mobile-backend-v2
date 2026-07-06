import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Index('idx_tp_rider_status', ['rider_id', 'status'])
@Index('idx_tp_customer', ['customer_id'])
@Entity('trip_payments')
export class TripPayment {
  @PrimaryGeneratedColumn('increment') id: number;
  @Column('bigint', { unique: true }) trip_id: string;
  @Column('bigint') rider_id: string;
  @Column('bigint') customer_id: string;
  @Column({ length: 10 }) payment_method: string; // 'wallet', 'cash', 'mixed'
  @Column('bigint') original_fare: number;
  @Column('bigint') discounted_fare: number;
  @Column('bigint', { default: 0 }) discount_amount: number;
  @Column({ nullable: true, type: 'bigint' }) commission_amount?: number;
  @Column({ nullable: true, type: 'integer' }) commission_rate?: number;
  @Column({ nullable: true, type: 'bigint' }) hold_id?: string;
  @Column({ length: 20, default: 'pending' }) status: string; // 'pending', 'hold_placed', 'cash_collected', 'completed', 'cancelled', 'refunded'
  @Column({ nullable: true, type: 'timestamp' }) cash_collected_at?: Date;
  @Column({ nullable: true, type: 'timestamp' }) completed_at?: Date;
  @Column({ nullable: true, type: 'timestamp' }) cancelled_at?: Date;
  @Column({ nullable: true, type: 'bigint' }) cancellation_fee?: number;
  @Column({ length: 64, unique: true }) idempotency_key: string;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamp' }) updated_at: Date;
}
