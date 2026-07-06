import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSessionTables1720500000000 implements MigrationInterface {
  name = 'CreateSessionTables1720500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create user_active_sessions table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_active_sessions (
        session_id SERIAL PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        user_type VARCHAR(10) NOT NULL,
        device_id VARCHAR(255) NOT NULL,
        device_hash VARCHAR(64) NOT NULL,
        token_hash VARCHAR(64) NOT NULL,
        device_name VARCHAR(255),
        ip_address VARCHAR(45),
        logged_in_at TIMESTAMP NOT NULL DEFAULT NOW(),
        last_active_at TIMESTAMP NOT NULL DEFAULT NOW(),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        invalidated_at TIMESTAMP,
        invalidated_reason VARCHAR(100),
        UNIQUE (user_id, user_type)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_uas_token ON user_active_sessions(token_hash)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_uas_device ON user_active_sessions(device_hash)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_active_sessions`);
  }
}
