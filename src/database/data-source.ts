import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { entities } from '../entities';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL || 'postgresql://vida:password@localhost:5433/vida_rider',
  entities,
  migrations: ['migrations/*.ts']
});
