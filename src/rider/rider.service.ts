import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { createCipheriv, createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { ApiError } from '../common/api-error';
import { accountRegex, answerKey, documentTypes, ifscRegex, isAdult, maskAccount, moduleIds, normalizeModuleId } from '../common/utils';
import { BackgroundCheck, BankAccount, OnboardingEvent, QuizAttempt, QuizQuestion, Rider, RiderDocument, TrainingProgress } from '../entities';

const modules = [
  ['app_navigation', 'How to Use Rider App', 5], ['order_acceptance', 'Accepting Orders', 4], ['pickup_delivery', 'Pickup & Delivery', 6],
  ['customer_interaction', 'Customer Communication', 4], ['traffic_safety', 'Road Safety', 5], ['platform_policies', 'Platform Rules & Earnings', 5]
];

@Injectable()
export class RiderService {
  private readonly logger = new Logger(RiderService.name);

  constructor(
    @InjectRepository(Rider) private riders: Repository<Rider>,
    @InjectRepository(RiderDocument) private docs: Repository<RiderDocument>,
    @InjectRepository(BackgroundCheck) private bgs: Repository<BackgroundCheck>,
    @InjectRepository(TrainingProgress) private progress: Repository<TrainingProgress>,
    @InjectRepository(QuizAttempt) private attempts: Repository<QuizAttempt>,
    @InjectRepository(QuizQuestion) private questions: Repository<QuizQuestion>,
    @InjectRepository(BankAccount) private banks: Repository<BankAccount>,
    @InjectRepository(OnboardingEvent) private events: Repository<OnboardingEvent>,
    @InjectQueue('onboarding') private onboardingQueue: Queue
  ) {}

  async profile(id: string) {
    const rider = await this.mustRider(id);
    const bank = await this.banks.findOne({ where: { rider_id: id, is_primary: true }, order: { created_at: 'DESC' } });
    return { rider_id: rider.id, mobile: rider.mobile, name: rider.name, date_of_birth: rider.date_of_birth, gender: rider.gender, city: rider.city, vehicle_type: rider.vehicle_type, max_parcel_weight_kg: Number(rider.max_parcel_weight_kg), onboarding_status: rider.onboarding_status, rating: Number(rider.rating), total_deliveries: rider.total_deliveries, acceptance_rate: Number(rider.acceptance_rate), cancellation_score: rider.cancellation_score, activated_at: rider.activated_at, created_at: rider.created_at, bank_account: bank ? { account_masked: bank.account_number_masked, ifsc_code: bank.ifsc_code, upi_id: bank.upi_id, verification_status: bank.verification_status } : null };
  }

  async updateProfile(id: string, body: any) {
    await this.riders.update(id, { name: body.name, city: body.city, vehicle_type: body.vehicle_type, max_parcel_weight_kg: body.max_parcel_weight_kg });
    return { message: 'Profile updated', rider_id: id };
  }

  async completeProfile(id: string, body: any) {
    if (!body.name || body.name.trim().length < 2) throw new ApiError('VALIDATION_ERROR', 'Name must be at least 2 characters', HttpStatus.BAD_REQUEST);
    if (!isAdult(body.date_of_birth)) throw new ApiError('AGE_INELIGIBLE', 'Must be at least 18 years old', HttpStatus.UNPROCESSABLE_ENTITY);
    await this.riders.update(id, { name: body.name, date_of_birth: body.date_of_birth, gender: body.gender, city: body.city, vehicle_type: body.vehicle_type });
    return { rider_id: id, onboarding_status: 'registered', profile_completed: true, next_step: 'documents' };
  }

  async uploadDocument(riderId: string, type: string, file?: Express.Multer.File) {
    if (!documentTypes.includes(type as any) || !file) throw new ApiError('DOCUMENT_INVALID', 'Invalid document', HttpStatus.UNPROCESSABLE_ENTITY);
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.mimetype)) throw new ApiError('DOCUMENT_INVALID', 'Invalid format', HttpStatus.UNPROCESSABLE_ENTITY);
    await this.docs.upsert({ rider_id: riderId, document_type: type, file_url: `/uploads/${file.filename}`, file_name: file.originalname, file_size_bytes: file.size, mime_type: file.mimetype, upload_status: 'accepted', verification_status: 'pending', failure_reason: null, verified_at: null, expires_at: null }, ['rider_id', 'document_type']);
    const checklist = await this.checklist(riderId);
    return { document_type: type, upload_status: 'accepted', verification_status: 'pending', file_url: `/uploads/${file.filename}`, checklist: checklist.checklist, all_uploaded: checklist.uploaded_count === 4, uploaded_count: checklist.uploaded_count, total_required: 4 };
  }

  async submitDocuments(riderId: string) {
    const c = await this.checklist(riderId);
    if (c.uploaded_count < 4) throw new ApiError('DOCUMENTS_INCOMPLETE', 'All 4 documents must be uploaded', HttpStatus.UNPROCESSABLE_ENTITY);
    await this.setStatus(riderId, 'documents_submitted', 'documents_submitted');
    await this.onboardingQueue.add('auto-verify-documents', { riderId }, { delay: 5000 });
    return { onboarding_status: 'documents_submitted', message: 'Documents submitted for verification', estimated_verification_hours: 24 };
  }

  async documents(riderId: string) {
    const rider = await this.mustRider(riderId);
    const docs = await this.docs.find({ where: { rider_id: riderId }, order: { created_at: 'ASC' } });
    const verified = docs.filter(d => d.verification_status === 'verified').length;
    return { documents: docs.map(d => ({ document_type: d.document_type, upload_status: d.upload_status, verification_status: d.verification_status, file_url: d.file_url, failure_reason: d.failure_reason, uploaded_at: d.created_at, verified_at: d.verified_at || null, expires_at: d.expires_at || null })), all_verified: verified === 4, verified_count: verified, onboarding_status: rider.onboarding_status };
  }

  async initiateBackground(riderId: string) {
    const rider = await this.mustRider(riderId);
    if (rider.onboarding_status !== 'documents_verified') throw new ApiError('INVALID_STATE', 'Documents must be verified first', HttpStatus.CONFLICT);
    await this.bgs.save({ rider_id: riderId, status: 'pending' });
    await this.setStatus(riderId, 'background_check_in_progress', 'background_check_initiated');
    await this.onboardingQueue.add('auto-clear-background', { riderId }, { delay: 5000 });
    return { status: 'pending', onboarding_status: 'background_check_in_progress', estimated_hours: 48 };
  }

  async background(riderId: string) {
    const rider = await this.mustRider(riderId);
    const bg = await this.bgs.findOne({ where: { rider_id: riderId }, order: { initiated_at: 'DESC' } });
    return { status: bg?.status || 'pending', onboarding_status: rider.onboarding_status, completed_at: bg?.completed_at || null };
  }

  async training(riderId: string) {
    const rows = await this.progress.find({ where: { rider_id: riderId } });
    const map = new Map(rows.map(r => [r.module_id, r]));
    const completed = rows.filter(r => r.status === 'completed').length;
    const quiz = await this.attempts.findOne({ where: { rider_id: riderId, passed: true } });
    return { modules: modules.map(([id, title, duration]) => ({ module_id: id, title, duration_minutes: duration, status: map.get(id as string)?.status || 'pending', completed_at: map.get(id as string)?.completed_at })), completed_count: completed, total_modules: 6, quiz_unlocked: completed === 6, quiz_passed: !!quiz };
  }

  async updateModule(riderId: string, moduleId: string, status: string) {
    const normalizedModuleId = normalizeModuleId(moduleId);
    if (!moduleIds.includes(normalizedModuleId as any)) throw new ApiError('VALIDATION_ERROR', 'Invalid module_id', HttpStatus.BAD_REQUEST);
    await this.progress.upsert({ rider_id: riderId, module_id: normalizedModuleId, status, completed_at: status === 'completed' ? new Date() : null }, ['rider_id', 'module_id']);
    const completed = await this.progress.count({ where: { rider_id: riderId, status: 'completed' } });
    if (completed >= 1) await this.setStatus(riderId, 'training_in_progress', 'training_started');
    return { module_id: normalizedModuleId, status, completed_count: completed, total_modules: 6, quiz_unlocked: completed === 6 };
  }

  async quizQuestions() {
    const qs = await this.questions.find({ where: { is_active: true }, order: { id: 'ASC' }, take: 10 });
    return { questions: qs.map((q, index) => ({ index, question: q.question, options: q.options })), total_questions: qs.length || 10, pass_score: 8 };
  }

  async submitQuiz(riderId: string, answers: Record<string, number>) {
    if (await this.progress.count({ where: { rider_id: riderId, status: 'completed' } }) < 6) throw new ApiError('TRAINING_INCOMPLETE', 'Complete all modules first', HttpStatus.UNPROCESSABLE_ENTITY);
    const score = answerKey.reduce((sum, correct, i) => sum + (Number(answers?.[i]) === correct ? 1 : 0), 0);
    const passed = score >= 8;
    await this.attempts.save({ rider_id: riderId, answers, score, total_questions: 10, passed });
    if (passed) await this.setStatus(riderId, 'training_completed', 'quiz_passed');
    return passed ? { score, total_questions: 10, passed, pass_score: 8, onboarding_status: 'training_completed', message: 'Congratulations! You passed the quiz.' } : { score, total_questions: 10, passed, pass_score: 8, message: `You scored ${score}/10. You need 8 to pass. Review the modules and try again.`, can_retry: true };
  }

  async submitBank(riderId: string, body: any) {
    await this.mustRider(riderId);
    if (!accountRegex.test(body.account_number || '')) throw new ApiError('ACCOUNT_NUMBER_INVALID', 'Invalid account number', HttpStatus.UNPROCESSABLE_ENTITY);
    if (!ifscRegex.test(body.ifsc_code || '')) throw new ApiError('IFSC_INVALID', 'Invalid IFSC code', HttpStatus.UNPROCESSABLE_ENTITY);
    if (body.upi_id && !String(body.upi_id).includes('@')) throw new ApiError('UPI_INVALID', 'Invalid UPI ID', HttpStatus.UNPROCESSABLE_ENTITY);
    const masked = maskAccount(body.account_number);
    await this.banks.save({ rider_id: riderId, account_holder_name: body.account_holder_name, account_number_encrypted: this.encrypt(body.account_number), account_number_masked: masked, ifsc_code: body.ifsc_code, upi_id: body.upi_id, verification_status: 'verified', verified_at: new Date() });
    await this.setStatus(riderId, 'bank_verified', 'bank_verified');
    return { verification_status: 'verified', account_masked: masked, ifsc_code: body.ifsc_code, upi_id: body.upi_id, onboarding_status: 'bank_verified', message: 'Bank account verified successfully' };
  }

  async accountDetails(riderId: string) {
    const rider = await this.mustRider(riderId);
    const bank = await this.banks.findOne({ where: { rider_id: riderId, is_primary: true }, order: { created_at: 'DESC' } });
    return {
      rider_id: rider.id,
      name: rider.name,
      mobile: rider.mobile,
      onboarding_status: rider.onboarding_status,
      bank_account: bank ? {
        bank_account_id: bank.id,
        account_holder_name: bank.account_holder_name,
        account_masked: bank.account_number_masked,
        ifsc_code: bank.ifsc_code,
        upi_id: bank.upi_id || null,
        verification_status: bank.verification_status,
        verified_at: bank.verified_at || null,
        is_primary: bank.is_primary,
        submitted_at: bank.created_at
      } : null,
      has_bank_account: !!bank
    };
  }

  async updateDeviceToken(riderId: string, body: any) {
    await this.mustRider(riderId);
    const token = body?.fcm_token?.toString();
    const platform = body?.platform?.toString() || 'android';
    const appType = body?.app_type?.toString() || 'rider';
    const deviceId = body?.device_id?.toString() || null;

    if (!token || token.length < 20) {
      throw new ApiError('DEVICE_TOKEN_INVALID', 'Invalid device token', HttpStatus.BAD_REQUEST);
    }
    if (platform !== 'android') {
      throw new ApiError('DEVICE_PLATFORM_INVALID', 'Invalid device platform', HttpStatus.BAD_REQUEST);
    }
    if (appType !== 'rider') {
      throw new ApiError('APP_TYPE_INVALID', 'Invalid app type', HttpStatus.BAD_REQUEST);
    }

    const updatedAt = new Date();
    await this.riders.update(riderId, {
      fcm_token: token,
      device_platform: platform,
      app_type: appType,
      device_id: deviceId || undefined,
      device_token_updated_at: updatedAt,
    });
    this.logger.log(JSON.stringify({
      event: 'ZipplyRiderDeviceTokenUpdated',
      rider_id: riderId,
      platform,
      app_type: appType,
      device_id: deviceId,
      token_suffix: token.slice(-6),
      updated_at: updatedAt.toISOString(),
    }));
    return {
      rider_id: riderId,
      platform,
      app_type: appType,
      device_token_updated_at: updatedAt,
    };
  }

  async activate(riderId: string) {
    const status = await this.onboardingStatus(riderId);
    const optionalUntilUiReady = ['activation', 'background_check', 'training'];
    const missing = Object.entries(status.steps).filter(([, v]: any) => !v.completed).map(([k]) => k).filter(k => !optionalUntilUiReady.includes(k));
    if (missing.length) throw new ApiError('ACTIVATION_INCOMPLETE', 'Activation incomplete', HttpStatus.UNPROCESSABLE_ENTITY, { missing_steps: missing });
    const activated_at = new Date();
    await this.riders.update(riderId, { onboarding_status: 'activated', activated_at });
    await this.events.save({ rider_id: riderId, event_type: 'activated', to_status: 'activated' });
    return { onboarding_status: 'activated', activated_at, message: 'Your account is activated! You can now go online and start earning.' };
  }

  async onboardingStatus(riderId: string) {
    const rider = await this.mustRider(riderId);
    const c = await this.checklist(riderId);
    const bg = await this.bgs.findOne({ where: { rider_id: riderId }, order: { initiated_at: 'DESC' } });
    const bank = await this.banks.findOne({ where: { rider_id: riderId, verification_status: 'verified' } });
    const steps: any = { profile: { completed: !!(rider.name && rider.city) }, documents: { completed: c.verified_count === 4, uploaded_count: c.uploaded_count, verified_count: c.verified_count, all_verified: c.verified_count === 4 }, background_check: { completed: bg?.status === 'cleared', status: bg?.status || 'pending' }, bank: { completed: !!bank }, activation: { completed: rider.onboarding_status === 'activated' } };
    const completed_steps = Object.values(steps).filter((s: any) => s.completed).length;
    return { rider_id: riderId, onboarding_status: rider.onboarding_status, steps, completed_steps, total_steps: 5, current_step: this.currentStep(steps), next_action: this.nextAction(steps) };
  }

  async setStatus(riderId: string, to: string, event: string) {
    const rider = await this.mustRider(riderId);
    await this.riders.update(riderId, { onboarding_status: to });
    await this.events.save({ rider_id: riderId, event_type: event, from_status: rider.onboarding_status, to_status: to });
  }

  private async checklist(riderId: string) {
    const docs = await this.docs.find({ where: { rider_id: riderId } });
    const checklist: any = {};
    for (const t of documentTypes) {
      const doc = docs.find(d => d.document_type === t);
      checklist[t] = doc ? { status: 'uploaded', verification: doc.verification_status } : { status: 'not_uploaded' };
    }
    return { checklist, uploaded_count: docs.length, verified_count: docs.filter(d => d.verification_status === 'verified').length };
  }

  private async mustRider(id: string) {
    const rider = await this.riders.findOneBy({ id });
    if (!rider) throw new ApiError('RIDER_NOT_FOUND', 'Rider not found', HttpStatus.NOT_FOUND);
    return rider;
  }

  private encrypt(value: string) {
    const key = createHash('sha256').update(process.env.JWT_SECRET || 'your-secret-key-256-bit-minimum').digest();
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    return `${iv.toString('hex')}:${Buffer.concat([cipher.update(value), cipher.final()]).toString('hex')}`;
  }

  private currentStep(steps: any) { return Object.keys(steps).find(k => !steps[k].completed) || 'complete'; }
  private nextAction(steps: any) {
    if (!steps.profile.completed) return 'Complete your profile';
    if (!steps.documents.completed) return 'Upload and verify documents';
    if (!steps.background_check.completed) return 'Complete background check';
    if (!steps.bank.completed) return 'Submit bank account';
    if (!steps.activation.completed) return 'Activate account';
    return 'Start delivering';
  }
}
