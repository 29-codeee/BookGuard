import { getRedis } from './client.js';
import {
  holdInventory,
  expireHold as engineExpireHold,
  sweepExpiredHolds,
  broadcastInventoryUpdate as engineBroadcastInventoryUpdate,
  HoldResult as EngineHoldResult
} from '../booking/engine.js';

/**
 * Backwards-compatible facade over the booking engine (src/booking/engine.ts).
 * Existing callers (demo routes, load tests) keep using createHold/expireHold;
 * all inventory logic lives in the engine.
 */

export interface CreateHoldParams {
  travellerId: string;
  inventoryId: string;
  quantity?: number;
  ttlSeconds?: number;
  /** Ops trace correlation id (see eventHub.emitTrace). */
  traceId?: string;
}

export type HoldResult = EngineHoldResult;

/** Throws an Error whose message is the code, e.g. 'INSUFFICIENT_INVENTORY'. */
export async function createHold(params: CreateHoldParams): Promise<HoldResult> {
  const { hold } = await holdInventory(params);
  return hold;
}

export async function expireHold(holdId: string): Promise<boolean> {
  return engineExpireHold(holdId);
}

export async function broadcastInventoryUpdate(inventoryId?: string): Promise<void> {
  return engineBroadcastInventoryUpdate(inventoryId);
}

let sweeperTimer: NodeJS.Timeout | null = null;

// Initialize Hold Sweeper: Redis TTL events are the fast path; the DB sweep is the safety net.
export function startHoldSweeper(intervalMs = 3000): void {
  const redis = getRedis();
  redis.onExpiry(async (expiredKey: string) => {
    if (expiredKey.startsWith('hold:')) {
      const holdId = expiredKey.replace('hold:', '');
      try {
        await engineExpireHold(holdId);
      } catch (err) {
        console.error(`[HoldSweeper] Error expiring hold ${holdId}:`, err);
      }
    }
  });

  if (sweeperTimer) return;
  sweeperTimer = setInterval(async () => {
    try {
      await sweepExpiredHolds();
    } catch (err) {
      console.error('[HoldSweeper] Periodic sweep failed:', err);
    }
  }, intervalMs);
}

export function stopHoldSweeper(): void {
  if (sweeperTimer) clearInterval(sweeperTimer);
  sweeperTimer = null;
}
