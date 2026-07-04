import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('order_events')
export class OrderEvent {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ length: 50 }) order_id: string;
  @Column({ length: 50 }) event_type: string;
  @Column({ length: 100 }) title: string;
  @Column({ nullable: true, length: 255 }) description?: string;
  @Column({ type: 'jsonb', nullable: true }) details?: Record<string, unknown>;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
}
