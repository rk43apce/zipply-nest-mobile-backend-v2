import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index('idx_wal_wallet_time', ['wallet_id', 'created_at'])
@Index('idx_wal_action', ['action'])
@Index('idx_wal_entity', ['entity_type', 'entity_id'])
@Entity('wallet_audit_log')
export class WalletAuditLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ type: 'varchar', length: 64 }) wallet_id: string;
  @Column({ length: 20 }) actor_type: string; // 'user', 'system', 'admin', 'gateway_webhook'
  @Column({ nullable: true, length: 64 }) actor_id?: string;
  @Column({ length: 100 }) action: string;
  @Column({ length: 50 }) entity_type: string;
  @Column() entity_id: number;
  @Column({ type: 'jsonb', nullable: true }) old_state?: Record<string, any>;
  @Column({ type: 'jsonb', nullable: true }) new_state?: Record<string, any>;
  @Column({ nullable: true, length: 45 }) ip_address?: string;
  @Column({ nullable: true, length: 500 }) user_agent?: string;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
}
