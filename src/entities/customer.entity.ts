import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true, length: 15 }) mobile: string;
  @Column({ nullable: true, length: 100 }) name?: string;
  @Column({ nullable: true, length: 255 }) email?: string;
  @Column({ default: false }) is_verified: boolean;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamp' }) updated_at: Date;
}
