import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignWalletAuditWalletId1721100000000 implements MigrationInterface {
  name = 'AlignWalletAuditWalletId1721100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Wallet primary keys are UUIDs. Preserve legacy numeric audit references
    // by converting them through text while allowing all current wallet IDs.
    await queryRunner.query(`
      ALTER TABLE wallet_audit_log
      ALTER COLUMN wallet_id TYPE VARCHAR(64) USING wallet_id::text
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // UUID wallet references cannot be safely converted back to BIGINT.
  }
}
