import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSupportTickets1721400000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE support_tickets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rider_id UUID NOT NULL REFERENCES riders(id),
      order_id VARCHAR(50),
      category VARCHAR(40) NOT NULL,
      subject VARCHAR(120) NOT NULL,
      description TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      priority VARCHAR(20) NOT NULL DEFAULT 'normal',
      source VARCHAR(30) NOT NULL DEFAULT 'rider_app',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
    await queryRunner.query('CREATE INDEX idx_support_ticket_rider_created ON support_tickets(rider_id, created_at DESC)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS support_tickets');
  }
}
