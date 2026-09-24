import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  redisUrl: process.env.REDIS_URL || '',
  mockProviderUrl: process.env.MOCK_PROVIDER_URL || 'http://localhost:3002',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  defaultHoldTtlSeconds: parseInt(process.env.DEFAULT_HOLD_TTL_SECONDS || '60', 10), // 60 seconds
  demoHoldTtlSeconds: parseInt(process.env.DEMO_HOLD_TTL_SECONDS || '15', 10), // 15 seconds for quick demo
  dbSchemaPath: path.resolve(__dirname, '../../../db/schema.sql'),
  dbSeedPath: path.resolve(__dirname, '../../../db/seed.sql')
};
