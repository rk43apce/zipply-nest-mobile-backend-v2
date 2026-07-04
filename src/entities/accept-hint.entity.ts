import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index('idx_accept_hint_offer_rider', ['offer_id', 'rider_id'], { unique: true })
@Index('idx_accept_hint_idempotency_key', ['idempotency_key'], { unique: true })
@Entity('accept_hints')
export class AcceptHint {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') offer_id: string;
  @Column('uuid') rider_id: string;
  @Column('uuid') dispatch_id: string;
  @Column({ length: 50 }) order_id: string;
  @Column({ length: 100, nullable: true }) idempotency_key?: string;
  @Column({ type: 'jsonb' }) assignment_payload: unknown;
  @Column({ type: 'timestamp', default: () => 'NOW()' }) created_at: Date;
  @Column({ type: 'timestamp', default: () => 'NOW()', onUpdate: 'NOW()' }) updated_at: Date;
}
