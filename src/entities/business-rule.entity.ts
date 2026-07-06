import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Index('idx_br_key_active', ['rule_key', 'is_active', 'effective_from'])
@Entity('business_rules')
export class BusinessRule {
  @PrimaryGeneratedColumn('increment', { name: 'rule_id' }) id: number;
  @Column({ length: 100 }) rule_key: string;
  @Column('text') rule_value: string;
  @Column({ length: 10, default: 'string' }) value_type: string; // 'int', 'string', 'json', 'boolean'
  @Column({ type: 'timestamp', default: () => 'NOW()' }) effective_from: Date;
  @Column({ nullable: true, type: 'timestamp' }) effective_to?: Date;
  @Column({ default: true }) is_active: boolean;
  @Column({ length: 64 }) created_by: string;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamp' }) updated_at: Date;
}
