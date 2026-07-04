import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
@Entity('background_checks')
export class BackgroundCheck {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') rider_id: string;
  @Column({ length: 20, default: 'pending' }) status: string;
  @Column({ nullable: true, length: 100 }) provider_reference?: string;
  @Column({ type: 'jsonb', nullable: true }) result_details?: unknown;
  @Column({ type: 'timestamp', default: () => 'NOW()' }) initiated_at: Date;
  @Column({ type: 'timestamp', nullable: true }) completed_at?: Date;
}
