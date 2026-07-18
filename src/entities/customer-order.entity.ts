import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Index('idx_orders_customer_created', ['customer_id', 'created_at'])
@Index('idx_orders_status_city_created', ['status', 'created_at'])
@Entity('orders')
export class CustomerOrder {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true, length: 50 }) order_id: string;
  @Column('uuid') customer_id: string;
  @Index('idx_orders_idempotency_key', { unique: true, where: 'idempotency_key IS NOT NULL' })
  @Column({ nullable: true, length: 80 }) idempotency_key?: string;
  @Column({ length: 30, default: 'pending' }) status: string;
  @Column('decimal', { precision: 10, scale: 7 }) pickup_lat: number;
  @Column('decimal', { precision: 10, scale: 7 }) pickup_lng: number;
  @Column({ length: 255 }) pickup_address: string;
  @Column({ nullable: true, length: 100 }) pickup_contact_name?: string;
  @Column({ nullable: true, length: 15 }) pickup_contact_phone?: string;
  @Column('decimal', { precision: 10, scale: 7 }) dropoff_lat: number;
  @Column('decimal', { precision: 10, scale: 7 }) dropoff_lng: number;
  @Column({ length: 255 }) dropoff_address: string;
  @Column({ length: 100 }) dropoff_contact_name: string;
  @Column({ length: 15 }) dropoff_contact_phone: string;
  @Column('decimal', { precision: 5, scale: 2, default: 1 }) parcel_weight_kg: number;
  @Column({ type: 'text', nullable: true }) special_notes?: string;
  @Column('decimal', { precision: 6, scale: 2, nullable: true }) distance_km?: number;
  @Column() base_fare: number;
  @Column() distance_fare: number;
  @Column({ default: 0 }) weight_surcharge: number;
  @Column({ default: 500 }) platform_fee: number;
  @Column() total_amount: number;
  @Column({ length: 20, default: 'wallet' }) payment_method: string;
  @Column({ length: 30, default: 'pending' }) payment_status: string;
  @Column({ nullable: true, length: 100 }) payment_reference_id?: string;
  @Column('uuid', { nullable: true }) hold_id?: string;
  @Column({ default: 0 }) cancellation_fee: number;
  @Column('uuid', { nullable: true }) assigned_rider_id?: string;
  @Column({ nullable: true, length: 100 }) rider_name?: string;
  @Column({ nullable: true, length: 15 }) rider_phone_masked?: string;
  @Column({ nullable: true, length: 20 }) rider_vehicle_type?: string;
  @Column('decimal', { precision: 3, scale: 2, nullable: true }) rider_rating?: number;
  @Column({ nullable: true }) estimated_delivery_minutes?: number;
  @Column({ nullable: true, length: 6 }) pickup_otp?: string;
  @Column({ type: 'timestamp', nullable: true }) pickup_otp_verified_at?: Date;
  @Column({ type: 'timestamp', nullable: true }) confirmed_at?: Date;
  @Column({ type: 'timestamp', nullable: true }) assigned_at?: Date;
  @Column({ type: 'timestamp', nullable: true }) picked_up_at?: Date;
  @Column({ type: 'timestamp', nullable: true }) delivered_at?: Date;
  @Column({ type: 'timestamp', nullable: true }) cancelled_at?: Date;
  @Column({ nullable: true, length: 255 }) cancel_reason?: string;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamp' }) updated_at: Date;
}
