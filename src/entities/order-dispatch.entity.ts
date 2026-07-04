import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
@Index('idx_dispatch_status_city_started', ['status', 'city', 'started_at'])
@Index('idx_dispatch_rider_status_started', ['assigned_rider_id', 'status', 'started_at'])
@Entity('order_dispatches')
export class OrderDispatch {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true, length: 50 }) order_id: string;
  @Column({ length: 30, default: 'searching' }) status: string;
  @Column({ type: 'smallint', default: 1 }) phase: number;
  @Column({ length: 50 }) city: string;
  @Column('decimal', { precision: 10, scale: 7 }) pickup_lat: number;
  @Column('decimal', { precision: 10, scale: 7 }) pickup_lng: number;
  @Column({ nullable: true, length: 255 }) pickup_address?: string;
  @Column({ nullable: true, length: 100 }) pickup_contact_name?: string;
  @Column({ nullable: true, length: 15 }) pickup_contact_phone?: string;
  @Column('decimal', { precision: 10, scale: 7 }) dropoff_lat: number;
  @Column('decimal', { precision: 10, scale: 7 }) dropoff_lng: number;
  @Column({ nullable: true, length: 255 }) dropoff_address?: string;
  @Column({ nullable: true, length: 100 }) dropoff_contact_name?: string;
  @Column({ nullable: true, length: 15 }) dropoff_contact_phone?: string;
  @Column({ nullable: true, length: 50 }) customer_id?: string;
  @Column('decimal', { precision: 5, scale: 2, default: 2 }) parcel_weight_kg: number;
  @Column({ default: false }) requires_heavy_vehicle: boolean;
  @Column({ type: 'text', nullable: true }) special_notes?: string;
  @Column('uuid', { nullable: true }) assigned_rider_id?: string;
  @Column({ type: 'smallint', default: 0 }) redispatch_count: number;
  @Column({ default: 0 }) riders_offered_count: number;
  @Column({ default: 0 }) riders_rejected_count: number;
  @Column('decimal', { precision: 6, scale: 2, nullable: true }) distance_km?: number;
  @Column({ nullable: true }) estimated_earnings?: number;
  @Column({ type: 'timestamp', default: () => 'NOW()' }) started_at: Date;
  @Column({ type: 'timestamp', nullable: true }) assigned_at?: Date;
  @Column({ type: 'timestamp', nullable: true }) en_route_at?: Date;
  @Column({ type: 'timestamp', nullable: true }) arrived_pickup_at?: Date;
  @Column({ type: 'timestamp', nullable: true }) picked_up_at?: Date;
  @Column({ type: 'timestamp', nullable: true }) in_transit_at?: Date;
  @Column({ type: 'timestamp', nullable: true }) delivered_at?: Date;
  @Column({ type: 'timestamp', nullable: true }) cancelled_at?: Date;
}
