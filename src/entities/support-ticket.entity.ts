import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('support_tickets')
@Index('idx_support_ticket_rider_created', ['rider_id', 'created_at'])
export class SupportTicket {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') rider_id: string;
  @Column({ nullable: true }) order_id?: string;
  @Column({ length: 40 }) category: string;
  @Column({ length: 120 }) subject: string;
  @Column('text') description: string;
  @Column({ length: 20, default: 'open' }) status: string;
  @Column({ length: 20, default: 'normal' }) priority: string;
  @Column({ length: 30, default: 'rider_app' }) source: string;
  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
