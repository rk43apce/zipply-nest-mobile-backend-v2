import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('saved_addresses')
export class SavedAddress {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') customer_id: string;
  @Column({ length: 50 }) label: string;
  @Column({ length: 255 }) address: string;
  @Column('decimal', { precision: 10, scale: 7 }) lat: number;
  @Column('decimal', { precision: 10, scale: 7 }) lng: number;
  @Column({ nullable: true, length: 100 }) contact_name?: string;
  @Column({ nullable: true, length: 15 }) contact_phone?: string;
  @Column({ default: false }) is_default: boolean;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
}
