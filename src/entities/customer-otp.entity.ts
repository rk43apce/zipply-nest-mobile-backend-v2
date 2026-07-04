import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('customer_otp_requests')
export class CustomerOtpRequest {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ length: 15 }) mobile: string;
  @Column({ length: 255 }) otp_hash: string;
  @Column({ default: 0 }) attempts: number;
  @Column({ default: false }) is_verified: boolean;
  @Column({ type: 'timestamp', nullable: true }) locked_until?: Date;
  @Column({ type: 'timestamp' }) expires_at: Date;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
}
