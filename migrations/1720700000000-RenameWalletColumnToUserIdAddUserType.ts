import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameWalletColumnToUserIdAddUserType1720700000000 implements MigrationInterface {
  name = 'RenameWalletColumnToUserIdAddUserType1720700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if customer_id still exists (skip if already renamed)
    const colExists = await queryRunner.query(`
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'wallets' AND column_name = 'customer_id'
    `);
    
    if (colExists.length === 0) {
      // Already renamed, just ensure user_type and composite constraint exist
      await queryRunner.query(`
        ALTER TABLE wallets ADD COLUMN IF NOT EXISTS user_type VARCHAR(10) DEFAULT 'rider' CHECK (user_type IN ('rider', 'customer'))
      `);
      return;
    }

    // Rename customer_id to user_id
    await queryRunner.query(
      `ALTER TABLE wallets RENAME COLUMN customer_id TO user_id`
    );

    // Rename the unique constraint (may not exist)
    await queryRunner.query(
      `ALTER TABLE wallets RENAME CONSTRAINT wallets_customer_id_key TO wallets_user_id_key`
    );

    // Rename the index (may not exist)
    await queryRunner.query(
      `ALTER INDEX IF EXISTS idx_wallets_customer RENAME TO idx_wallets_user`
    );

    // Add user_type column with default 'rider'
    await queryRunner.query(
      `ALTER TABLE wallets ADD COLUMN IF NOT EXISTS user_type VARCHAR(10) DEFAULT 'rider' CHECK (user_type IN ('rider', 'customer'))`
    );

    // Create composite unique constraint for (user_id, user_type) to allow both riders and customers
    await queryRunner.query(
      `ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_user_id_key`
    );

    await queryRunner.query(
      `ALTER TABLE wallets ADD CONSTRAINT wallets_user_id_user_type_key UNIQUE (user_id, user_type)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the new composite unique constraint
    await queryRunner.query(
      `ALTER TABLE wallets DROP CONSTRAINT wallets_user_id_user_type_key`
    );

    // Re-add the old constraint
    await queryRunner.query(
      `ALTER TABLE wallets ADD CONSTRAINT wallets_user_id_key UNIQUE (user_id)`
    );

    // Remove user_type column
    await queryRunner.query(
      `ALTER TABLE wallets DROP COLUMN user_type`
    );

    // Rename index back
    await queryRunner.query(
      `ALTER INDEX idx_wallets_user RENAME TO idx_wallets_customer`
    );

    // Rename constraint back
    await queryRunner.query(
      `ALTER TABLE wallets RENAME CONSTRAINT wallets_user_id_key TO wallets_customer_id_key`
    );

    // Rename column back
    await queryRunner.query(
      `ALTER TABLE wallets RENAME COLUMN user_id TO customer_id`
    );
  }
}
