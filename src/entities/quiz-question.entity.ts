import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
@Entity('quiz_questions')
export class QuizQuestion {
  @PrimaryGeneratedColumn() id: number;
  @Column('text') question: string;
  @Column({ type: 'jsonb' }) options: string[];
  @Column() correct_option: number;
  @Column({ type: 'text', nullable: true }) explanation?: string;
  @Column({ default: true }) is_active: boolean;
}
