import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Index('idx_df_device_hash', ['device_hash'])
@Index('idx_df_user', ['user_id', 'user_type'])
@Entity('device_fingerprints')
export class DeviceFingerprint {
  @PrimaryGeneratedColumn('increment') id: number;
  @Column('bigint') user_id: string;
  @Column({ length: 10 }) user_type: string; // 'customer', 'rider'
  @Column({ length: 255 }) device_id: string;
  @Column({ length: 64 }) device_hash: string;
  @Column({ type: 'jsonb', nullable: true }) device_meta?: Record<string, any>;
  @CreateDateColumn({ type: 'timestamp' }) first_seen_at: Date;
  @UpdateDateColumn({ type: 'timestamp' }) last_seen_at: Date;
  @Column({ default: false }) is_flagged: boolean;
  @Column({ nullable: true, length: 255 }) flagged_reason?: string;
}
