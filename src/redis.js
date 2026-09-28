import Redis from 'ioredis';
import { config } from './config.js';

// Usado pelo adapter do Socket.IO (para rodar várias réplicas) e pelo /health.
export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
