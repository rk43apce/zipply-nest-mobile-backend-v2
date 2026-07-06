import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index('idx_pt_wallet_status', ['wallet_id', 'status'])
@Index('idx_pt_gateway_order', ['gateway_provider', 'gateway_order_id'])
@Entity('payment_transactions')
export class PaymentTransaction {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') wallet_id: string;
  @Column({ length: 64, unique: true }) idempotency_key: string;
  @Column({ nullable: true, length: 20 }) gateway_provider?: string; // 'razorpay', 'stripe', 'paytm', 'phonepe', 'manual'
  @Column({ nullable: true, length: 128 }) gateway_order_id?: string;
  @Column({ nullable: true, length: 128 }) gateway_payment_id?: string;
  @Column('bigint') amount: number;
  @Column({ nullable: true, length: 3, default: 'INR' }) currency_code?: string;
  @Column({ length: 15, default: 'pending' }) status: string; // 'pending', 'captured', 'failed', 'refunded'
  @Column({ nullable: true, length: 50 }) payment_method?: string;
  @Column({ type: 'jsonb', nullable: true }) metadata?: Record<string, any>;
  @CreateDateColumn({ type: 'timestamp' }) initiated_at: Date;
  @Column({ nullable: true, type: 'timestamp' }) captured_at?: Date;
  @Column({ nullable: true, type: 'timestamp' }) expires_at?: Date;
  
  // In-memory field for gateway signature (not stored in DB)
  gateway_signature?: string;
}
