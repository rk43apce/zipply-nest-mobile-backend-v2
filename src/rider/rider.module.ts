import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { RiderController } from './rider.controller';
import { RiderService } from './rider.service';
import { BackgroundCheck, BankAccount, OnboardingEvent, QuizAttempt, QuizQuestion, Rider, RiderDocument, TrainingProgress } from '../entities';

@Module({
  imports: [TypeOrmModule.forFeature([Rider, RiderDocument, BackgroundCheck, TrainingProgress, QuizAttempt, QuizQuestion, BankAccount, OnboardingEvent]), BullModule.registerQueue({ name: 'onboarding' })],
  providers: [RiderService],
  controllers: [RiderController],
  exports: [RiderService]
})
export class RiderModule {}
