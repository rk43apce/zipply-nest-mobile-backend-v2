import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
@Entity('quiz_attempts')
export class QuizAttempt {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') rider_id: string;
  @Column({ type: 'jsonb' }) answers: Record<string, number>;
  @Column() score: number;
  @Column({ default: 10 }) total_questions: number;
  @Column() passed: boolean;
  @Column({ type: 'timestamp', default: () => 'NOW()' }) attempted_at: Date;
}
