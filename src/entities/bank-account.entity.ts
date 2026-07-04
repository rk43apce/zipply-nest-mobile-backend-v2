import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
@Entity('bank_accounts')
export class BankAccount {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') rider_id: string;
  @Column({ length: 100 }) account_holder_name: string;
  @Column({ length: 500 }) account_number_encrypted: string;
  @Column({ length: 20 }) account_number_masked: string;
  @Column({ length: 11 }) ifsc_code: string;
  @Column({ nullable: true, length: 100 }) upi_id?: string;
  @Column({ length: 20, default: 'pending' }) verification_status: string;
  @Column({ type: 'timestamp', nullable: true }) verified_at?: Date;
  @Column({ default: true }) is_primary: boolean;
  @Column({ type: 'timestamp', default: () => 'NOW()' }) created_at: Date;
}
