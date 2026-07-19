import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { BankAccount, OrderDispatch, Rider, RiderEarning } from '../entities';
import { money, shortMoney } from '../common/utils';

@Injectable()
export class EarningsService {
  constructor(@InjectRepository(Rider) private riders: Repository<Rider>, @InjectRepository(RiderEarning) private earnings: Repository<RiderEarning>, @InjectRepository(OrderDispatch) private dispatches: Repository<OrderDispatch>, @InjectRepository(BankAccount) private banks: Repository<BankAccount>) {}
  async summary(riderId: string) {
    const rider = await this.riders.findOneBy({ id: riderId });
    const today = await this.sum(riderId, this.startOfDay(0), this.endOfDay(0));
    const week = await this.sum(riderId, this.startOfDay(6), this.endOfDay(0));
    return {
      today: { total: today.total, display_total: money(today.total), deliveries: today.deliveries, online_hours: null },
      week: { total: week.total, display_total: money(week.total), deliveries: week.deliveries },
      stats: { rating: Number(rider?.rating || 0), acceptance_rate: Number(rider?.acceptance_rate || 0), total_deliveries: rider?.total_deliveries || 0 },
      incentives: [],
      demand_guidance: { status: 'unavailable', message: 'Live demand guidance is not available in your area yet.' }
    };
  }
  async list(riderId: string, period: string) {
    const days = period === 'today' ? 1 : period === 'month' ? 30 : 7;
    const rows = await this.earnings.find({ where: { rider_id: riderId, earned_at: Between(this.startOfDay(days - 1), this.endOfDay(0)) } });
    const total = rows.reduce((s, r) => s + r.total, 0);
    const bank = await this.banks.findOne({ where: { rider_id: riderId }, order: { created_at: 'DESC' } });
    const daily = Array.from({ length: days }).map((_, i) => {
      const date = this.startOfDay(days - 1 - i);
      const dayRows = rows.filter(r => r.earned_at >= date && r.earned_at <= this.endOf(date));
      return { day: this.istDateLabel(date, { weekday: 'short' }), date: this.istIsoDate(date), amount: dayRows.reduce((s, r) => s + r.total, 0), deliveries: dayRows.filter(r => r.earning_type === 'delivery').length };
    });
    return { period, total_amount: total, display_total: money(total), total_deliveries: rows.filter(r => r.earning_type === 'delivery').length, avg_per_delivery: rows.length ? Math.round(total / rows.length) : 0, daily, breakdown: { base_fares: rows.reduce((s, r) => s + r.base_fare, 0), distance_bonuses: rows.reduce((s, r) => s + r.distance_bonus, 0), surge_bonuses: rows.reduce((s, r) => s + r.surge_bonus, 0), cancellation_compensation: rows.filter(r => r.earning_type === 'cancellation_compensation').reduce((s, r) => s + r.total, 0), total }, payout: { next_payout_day: 'Sunday', estimated_amount: total, bank_masked: bank?.account_number_masked, ifsc: bank?.ifsc_code, upi_id: bank?.upi_id } };
  }
  async deliveries(riderId: string, status: string, page: number, limit: number) {
    const safePage = Math.max(1, page || 1);
    const safeLimit = Math.min(Math.max(1, limit || 20), 100);
    const qb = this.dispatches.createQueryBuilder('d').where('d.assigned_rider_id = :riderId', { riderId }).orderBy('COALESCE(d.delivered_at, d.cancelled_at, d.started_at)', 'DESC').skip((safePage - 1) * safeLimit).take(safeLimit);
    if (status === 'completed') qb.andWhere('d.status = :s', { s: 'delivered' });
    if (status === 'cancelled') qb.andWhere('d.status = :s', { s: 'cancelled' });
    const [rows, total] = await qb.getManyAndCount();
    return { deliveries: rows.map(d => ({ order_id: d.order_id, from_address: d.pickup_address, to_address: d.dropoff_address, distance_km: Number(d.distance_km), duration_minutes: d.assigned_at && d.delivered_at ? Math.round((d.delivered_at.getTime() - d.assigned_at.getTime()) / 60000) : undefined, earnings: d.estimated_earnings || 0, display_earnings: money(d.estimated_earnings || 0), status: d.status === 'delivered' ? 'completed' : d.status, delivered_at: d.delivered_at, cancelled_at: d.cancelled_at })), pagination: { page: safePage, limit: safeLimit, total, total_pages: Math.ceil(total / safeLimit), has_next: safePage * safeLimit < total } };
  }
  async recent(riderId: string, limit: number) {
    const rows = await this.dispatches.find({ where: { assigned_rider_id: riderId, status: 'delivered' }, order: { delivered_at: 'DESC' }, take: limit });
    return { deliveries: rows.map(d => ({ order_id: d.order_id, from: d.pickup_address, to: d.dropoff_address, time: d.delivered_at?.toLocaleString('en-IN'), distance_km: Number(d.distance_km), earnings: d.estimated_earnings || 0, display_earnings: shortMoney(d.estimated_earnings || 0) })) };
  }
  private async sum(riderId: string, from: Date, to: Date) {
    const rows = await this.earnings.find({ where: { rider_id: riderId, earned_at: Between(from, to) } });
    return { total: rows.reduce((s, r) => s + r.total, 0), deliveries: rows.filter(r => r.earning_type === 'delivery').length };
  }
  private startOfDay(daysAgo: number) {
    const nowParts = this.istDateParts(new Date());
    return new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day - daysAgo, -5, -30, 0, 0));
  }
  private endOfDay(daysAgo: number) { return this.endOf(this.startOfDay(daysAgo)); }
  private endOf(d: Date) { return new Date(d.getTime() + 24 * 60 * 60 * 1000 - 1); }
  private istDateParts(date: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
    return { year: value('year'), month: value('month'), day: value('day') };
  }
  private istDateLabel(date: Date, options: Intl.DateTimeFormatOptions) {
    return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...options }).format(date);
  }
  private istIsoDate(date: Date) {
    const parts = this.istDateParts(date);
    return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
  }
}
