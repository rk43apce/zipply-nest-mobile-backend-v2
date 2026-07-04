import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('riders')
export class Rider {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true, length: 15 }) mobile: string;
  @Column({ nullable: true, length: 100 }) name?: string;
  @Column({ type: 'date', nullable: true }) date_of_birth?: string;
  @Column({ nullable: true, length: 10 }) gender?: string;
  @Column({ nullable: true, length: 50 }) city?: string;
  @Column({ length: 20, default: 'bike' }) vehicle_type: string;
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 10 }) max_parcel_weight_kg: number;
  @Column({ length: 50, default: 'registered' }) onboarding_status: string;
  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 }) rating: number;
  @Column({ default: 0 }) total_deliveries: number;
  @Column({ default: 0 }) total_ratings: number;
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 100 }) acceptance_rate: number;
  @Column({ default: 0 }) cancellation_score: number;
  @Column({ type: 'timestamp', nullable: true }) activated_at?: Date;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamp' }) updated_at: Date;
}
