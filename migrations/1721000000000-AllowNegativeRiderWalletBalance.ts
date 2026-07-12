import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowNegativeRiderWalletBalance1721000000000 implements MigrationInterface {
  name = 'AllowNegativeRiderWalletBalance1721000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_cached_balance_check`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE wallets ADD CONSTRAINT wallets_cached_balance_check CHECK (cached_balance >= 0) NOT VALID`);
  }
}
