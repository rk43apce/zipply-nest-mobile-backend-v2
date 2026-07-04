import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
@Entity('onboarding_events')
export class OnboardingEvent {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column('uuid') rider_id: string;
  @Column({ length: 50 }) event_type: string;
  @Column({ nullable: true, length: 50 }) from_status?: string;
  @Column({ nullable: true, length: 50 }) to_status?: string;
  @Column({ type: 'jsonb', nullable: true }) details?: unknown;
  @Column({ type: 'timestamp', default: () => 'NOW()' }) created_at: Date;
}
