import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
@Entity('dispatch_events')
export class DispatchEvent {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column('uuid') dispatch_id: string;
  @Column({ length: 50 }) order_id: string;
  @Column({ length: 50 }) event_type: string;
  @Column('uuid', { nullable: true }) rider_id?: string;
  @Column({ type: 'smallint', nullable: true }) phase?: number;
  @Column({ type: 'jsonb', nullable: true }) details?: unknown;
  @Column({ type: 'timestamp', default: () => 'NOW()' }) created_at: Date;
}
