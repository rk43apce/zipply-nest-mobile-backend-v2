import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRiderDocumentExpiry1721500000000
  implements MigrationInterface
{
  name = 'AddRiderDocumentExpiry1721500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "rider_documents" ADD COLUMN IF NOT EXISTS "expires_at" date',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "rider_documents" DROP COLUMN IF EXISTS "expires_at"',
    );
  }
}
