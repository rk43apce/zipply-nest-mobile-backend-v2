import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('order_ratings')
export class OrderRating {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true, length: 50 }) order_id: string;
  @Column('uuid') customer_id: string;
  @Column('uuid', { nullable: true }) rider_id?: string;
  @Column() delivery_rating: number;
  @Column() rider_rating: number;
  @Column({ type: 'text', nullable: true }) comments?: string;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
}
