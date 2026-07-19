import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiError } from '../common/api-error';
import { OrderDispatch, SupportTicket } from '../entities';

const categories = new Set(['active_delivery', 'customer_issue', 'payment_wallet', 'app_technical', 'documents_account', 'safety', 'other']);

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(SupportTicket) private tickets: Repository<SupportTicket>,
    @InjectRepository(OrderDispatch) private dispatches: Repository<OrderDispatch>,
  ) {}

  async create(riderId: string, body: any) {
    const category = body?.category?.toString();
    const description = body?.description?.toString().trim();
    const orderId = body?.order_id?.toString().trim() || undefined;
    if (!categories.has(category)) throw new ApiError('INVALID_SUPPORT_CATEGORY', 'Select a valid support category', HttpStatus.UNPROCESSABLE_ENTITY);
    if (!description || description.length < 10) throw new ApiError('SUPPORT_DESCRIPTION_REQUIRED', 'Please describe the issue in at least 10 characters', HttpStatus.UNPROCESSABLE_ENTITY);
    if (description.length > 2000) throw new ApiError('SUPPORT_DESCRIPTION_TOO_LONG', 'Support description is too long', HttpStatus.UNPROCESSABLE_ENTITY);
    if (orderId) {
      const delivery = await this.dispatches.findOneBy({ order_id: orderId, assigned_rider_id: riderId });
      if (!delivery) throw new ApiError('ORDER_NOT_ASSIGNED', 'This order is not assigned to the rider', HttpStatus.FORBIDDEN);
    }
    const ticket = await this.tickets.save({
      rider_id: riderId,
      order_id: orderId,
      category,
      subject: body?.subject?.toString().trim().slice(0, 120) || this.categoryLabel(category),
      description,
      priority: category === 'safety' ? 'urgent' : orderId ? 'high' : 'normal',
      status: 'open',
      source: 'rider_app',
    });
    return this.payload(ticket);
  }

  async list(riderId: string) {
    const rows = await this.tickets.find({ where: { rider_id: riderId }, order: { created_at: 'DESC' }, take: 20 });
    return { tickets: rows.map(ticket => this.payload(ticket)) };
  }

  private payload(ticket: SupportTicket) {
    return {
      ticket_id: ticket.id,
      ticket_reference: `ZST-${ticket.id.slice(0, 8).toUpperCase()}`,
      order_id: ticket.order_id || null,
      category: ticket.category,
      subject: ticket.subject,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      created_at: ticket.created_at,
      updated_at: ticket.updated_at,
    };
  }

  private categoryLabel(category: string) {
    const labels: Record<string, string> = {
      active_delivery: 'Active delivery',
      customer_issue: 'Customer issue',
      payment_wallet: 'Payment or wallet',
      app_technical: 'App or technical issue',
      documents_account: 'Documents or account',
      safety: 'Safety concern',
      other: 'Other support request',
    };
    return labels[category] || 'Support request';
  }
}
