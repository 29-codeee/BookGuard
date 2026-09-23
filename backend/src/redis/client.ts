import { Redis } from 'ioredis';
import { config } from '../config.js';

export interface RedisStoreInterface {
  set(key: string, val: string, mode?: string, duration?: number): Promise<string | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  onExpiry(callback: (expiredKey: string) => void): void;
}

class InMemoryRedisStore implements RedisStoreInterface {
  private store = new Map<string, { value: string; expiresAt: number }>();
  private expiryCallbacks: ((key: string) => void)[] = [];
  private sweeperTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.sweeperTimer = setInterval(() => this.sweepExpiredKeys(), 1000);
  }

  async set(key: string, val: string, mode?: string, duration?: number): Promise<string | null> {
    const ttlMs = (mode === 'EX' && duration) ? duration * 1000 : Infinity;
    this.store.set(key, {
      value: val,
      expiresAt: ttlMs === Infinity ? Infinity : Date.now() + ttlMs
    });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.notifyExpiry(key);
      return null;
    }
    return entry.value;
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return -2;
    if (entry.expiresAt === Infinity) return -1;
    const remainingMs = entry.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.store.delete(key);
      this.notifyExpiry(key);
      return -2;
    }
    return Math.ceil(remainingMs / 1000);
  }

  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replace('*', '');
    const validKeys: string[] = [];
    for (const [k, v] of this.store.entries()) {
      if (Date.now() > v.expiresAt) {
        this.store.delete(k);
        this.notifyExpiry(k);
      } else if (k.startsWith(prefix)) {
        validKeys.push(k);
      }
    }
    return validKeys;
  }

  onExpiry(callback: (expiredKey: string) => void): void {
    this.expiryCallbacks.push(callback);
  }

  private notifyExpiry(key: string): void {
    for (const cb of this.expiryCallbacks) {
      try {
        cb(key);
      } catch (err) {
        console.error('[RedisStore] Expiry callback error:', err);
      }
    }
  }

  private sweepExpiredKeys(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        this.notifyExpiry(key);
      }
    }
  }
}

let redisClient: RedisStoreInterface | null = null;

export async function initRedis(): Promise<RedisStoreInterface> {
  if (config.redisUrl) {
    try {
      console.log(`[Redis] Connecting to native Redis at ${config.redisUrl}...`);
      const nativeRedis = new Redis(config.redisUrl, {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000
      });
      await nativeRedis.ping();
      console.log('[Redis] Connected to native Redis server.');

      // Adapter wrapper for native Redis
      const wrapper: RedisStoreInterface = {
        set: (key, val, mode, duration) => nativeRedis.set(key, val, mode as any, duration as any),
        get: (key) => nativeRedis.get(key),
        del: (key) => nativeRedis.del(key),
        ttl: (key) => nativeRedis.ttl(key),
        keys: (pattern) => nativeRedis.keys(pattern),
        onExpiry: (callback) => {
          // Native subscriber for keyspace events
          const sub = new Redis(config.redisUrl);
          sub.psubscribe('__keyevent@0__:expired');
          sub.on('pmessage', (_pattern, _channel, expiredKey) => callback(expiredKey));
        }
      };
      redisClient = wrapper;
      return redisClient;
    } catch (err) {
      console.warn('[Redis] Native Redis unavailable, using in-memory Redis hold store:', (err as Error).message);
    }
  }

  console.log('[Redis] Using in-memory Redis hold engine with TTL timers and keyspace events.');
  redisClient = new InMemoryRedisStore();
  return redisClient;
}

export function getRedis(): RedisStoreInterface {
  if (!redisClient) {
    throw new Error('[Redis] Redis client not initialized');
  }
  return redisClient;
}
