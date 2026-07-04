import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
@Entity('rider_locations')
export class RiderLocation {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column('uuid') rider_id: string;
  @Column('decimal', { precision: 10, scale: 7 }) lat: number;
  @Column('decimal', { precision: 10, scale: 7 }) lng: number;
  @Column('decimal', { precision: 5, scale: 1, nullable: true }) speed?: number;
  @Column('decimal', { precision: 5, scale: 1, nullable: true }) bearing?: number;
  @Column({ type: 'timestamp', default: () => 'NOW()' }) recorded_at: Date;
}
