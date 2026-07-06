import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Index('idx_uas_token', ['token_hash'])
@Index('idx_uas_device', ['device_hash'])
@Entity('user_active_sessions')
export class UserActiveSession {
  @PrimaryGeneratedColumn('increment', { name: 'session_id' }) id: number;
  @Column({ length: 64 }) user_id: string;
  @Column({ length: 10 }) user_type: string; // 'customer', 'rider'
  @Column({ length: 255 }) device_id: string;
  @Column({ length: 64 }) device_hash: string;
  @Column({ length: 64 }) token_hash: string;
  @Column({ nullable: true, length: 255 }) device_name?: string;
  @Column({ nullable: true, length: 45 }) ip_address?: string;
  @CreateDateColumn({ type: 'timestamp', name: 'logged_in_at' }) logged_in_at: Date;
  @UpdateDateColumn({ type: 'timestamp', name: 'last_active_at' }) last_active_at: Date;
  @Column({ default: true }) is_active: boolean;
  @Column({ nullable: true, type: 'timestamp' }) invalidated_at?: Date;
  @Column({ nullable: true, length: 100 }) invalidated_reason?: string;
}
