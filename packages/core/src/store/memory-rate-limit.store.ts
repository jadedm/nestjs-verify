import {
  RateLimitHit,
  RateLimitStore,
} from '../interfaces/rate-limit-store.interface.js';

interface Entry {
  count: number;
  resetAt: number;
}

/**
 * Single-process in-memory rate limit store. Safe because Node's event
 * loop is single-threaded: each `hit` call reads and writes the entry
 * synchronously without yielding, so the increment is effectively atomic
 * within one process.
 *
 * Not safe across multiple Node processes. Use a shared backend
 * (PostgresRateLimitStore, MongoRateLimitStore, RedisRateLimitStore) for
 * multi-instance deployments.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, Entry>();

  async hit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitHit> {
    const now = Date.now();
    const existing = this.entries.get(key);
    let entry: Entry;
    if (!existing || existing.resetAt <= now) {
      entry = { count: 1, resetAt: now + windowSeconds * 1000 };
    } else {
      entry = { count: existing.count + 1, resetAt: existing.resetAt };
    }
    this.entries.set(key, entry);
    return {
      count: entry.count,
      limit,
      exceeded: entry.count > limit,
      resetAt: entry.resetAt,
    };
  }
}
