import { MigrationInterface, QueryRunner } from 'typeorm';

export class RiderWalletFKFix1720600000000 implements MigrationInterface {
  name = 'RiderWalletFKFix1720600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the foreign key constraint that ties wallets to customers
    await queryRunner.query(
      `ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_customer_id_fkey`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the FK if needed
    await queryRunner.query(
      `ALTER TABLE wallets ADD CONSTRAINT wallets_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id)`
    );
  }
}
