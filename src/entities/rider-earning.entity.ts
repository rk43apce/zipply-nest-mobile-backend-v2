import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
@Index('idx_earnings_rider_earned', ['rider_id', 'earned_at'])
@Entity('rider_earnings')
export class RiderEarning {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') rider_id: string;
  @Column({ length: 50 }) order_id: string;
  @Column('uuid', { nullable: true }) dispatch_id?: string;
  @Column({ length: 30, default: 'delivery' }) earning_type: string;
  @Column({ default: 0 }) base_fare: number;
  @Column({ default: 0 }) distance_bonus: number;
  @Column({ default: 0 }) surge_bonus: number;
  @Column({ default: 0 }) tip: number;
  @Column() total: number;
  @Column('decimal', { precision: 6, scale: 2, nullable: true }) distance_km?: number;
  @Column({ nullable: true }) duration_minutes?: number;
  @Column({ type: 'timestamp', default: () => 'NOW()' }) earned_at: Date;
}
