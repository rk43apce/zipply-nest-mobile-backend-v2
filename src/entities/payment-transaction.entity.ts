import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('payment_transactions')
export class PaymentTransaction {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') wallet_id: string;
  @Column() amount: number;
  @Column({ length: 3, default: 'INR' }) currency_code: string;
  @Column({ length: 20, default: 'pending' }) status: string;
  @Column({ length: 20, default: 'razorpay' }) gateway_provider: string;
  @Column({ nullable: true, length: 100 }) gateway_order_id?: string;
  @Column({ nullable: true, length: 100 }) gateway_payment_id?: string;
  @Column({ nullable: true, length: 30 }) payment_method?: string;
  @Column({ unique: true, length: 64 }) idempotency_key: string;
  @Column({ type: 'jsonb', nullable: true }) metadata?: Record<string, unknown>;
  @Column({ type: 'timestamp', default: () => 'NOW()' }) initiated_at: Date;
  @Column({ type: 'timestamp', nullable: true }) captured_at?: Date;
  @Column({ type: 'timestamp', nullable: true }) expires_at?: Date;
}
