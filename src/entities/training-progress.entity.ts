import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
@Entity('training_progress')
@Unique(['rider_id', 'module_id'])
export class TrainingProgress {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') rider_id: string;
  @Column({ length: 50 }) module_id: string;
  @Column({ length: 20, default: 'pending' }) status: string;
  @Column({ type: 'timestamp', nullable: true }) completed_at?: Date;
}
