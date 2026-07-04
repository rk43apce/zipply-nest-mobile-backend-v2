import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
@Index('idx_offers_rider_status_expires', ['rider_id', 'status', 'expires_at'])
@Index('idx_offers_order_status', ['order_id', 'status'])
@Entity('dispatch_offers')
export class DispatchOffer {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') dispatch_id: string;
  @Column({ length: 50 }) order_id: string;
  @Column('uuid') rider_id: string;
  @Column({ length: 20, default: 'pending' }) status: string;
  @Column({ type: 'smallint' }) phase: number;
  @Column('decimal', { precision: 6, scale: 2, nullable: true }) distance_km?: number;
  @Column({ nullable: true }) estimated_earnings?: number;
  @Column({ default: 30 }) timeout_seconds: number;
  @Column({ nullable: true, length: 50 }) reason?: string;
  @Column({ type: 'timestamp', default: () => 'NOW()' }) offered_at: Date;
  @Column({ type: 'timestamp', nullable: true }) responded_at?: Date;
  @Column({ type: 'timestamp' }) expires_at: Date;
}
