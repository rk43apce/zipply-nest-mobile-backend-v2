import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
@Entity('rider_documents')
@Unique(['rider_id', 'document_type'])
export class RiderDocument {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') rider_id: string;
  @Column({ length: 30 }) document_type: string;
  @Column({ length: 500 }) file_url: string;
  @Column({ nullable: true, length: 255 }) file_name?: string;
  @Column({ nullable: true }) file_size_bytes?: number;
  @Column({ nullable: true, length: 50 }) mime_type?: string;
  @Column({ length: 20, default: 'accepted' }) upload_status: string;
  @Column({ length: 20, default: 'pending' }) verification_status: string;
  @Column({ nullable: true, length: 255 }) failure_reason?: string | null;
  @Column({ type: 'timestamp', nullable: true }) verified_at?: Date | null;
  @Column({ type: 'date', nullable: true }) expires_at?: Date | null;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamp' }) updated_at: Date;
}
