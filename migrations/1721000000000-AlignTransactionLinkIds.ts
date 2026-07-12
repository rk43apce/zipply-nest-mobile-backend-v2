import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignTransactionLinkIds1721000000000 implements MigrationInterface {
  name = 'AlignTransactionLinkIds1721000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Payment and wallet transactions use UUID primary keys. Preserve any
    // legacy numeric link values by converting both columns through text.
    await queryRunner.query(`
      ALTER TABLE transaction_links
      ALTER COLUMN payment_txn_id TYPE VARCHAR(64) USING payment_txn_id::text,
      ALTER COLUMN wallet_txn_id TYPE VARCHAR(64) USING wallet_txn_id::text
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // UUID values cannot be represented as BIGINT, so reverting would destroy
    // valid links. Keep the compatible string representation.
  }
}
