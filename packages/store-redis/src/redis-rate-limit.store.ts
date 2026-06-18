import type { RateLimitHit, RateLimitStore } from '@jadedm/nestjs-verify';
import type { RedisLike } from './redis-like.interface.js';

/**
 * Atomic increment-with-window via a single Lua script. The script
 * branches on whether the key already has a TTL: if not, it sets one;
 * otherwise it simply increments. Returns the new count and the
 * remaining TTL in milliseconds, from which we compute resetAt.
 *
 * Lua scripts on Redis are atomic. Concurrent callers cannot race past
 * the counter ceiling.
 */
const HIT_SCRIPT = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
    return {current, ARGV[1]}
  end
  local pttl = redis.call('PTTL', KEYS[1])
  if pttl < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
    pttl = tonumber(ARGV[1])
  end
  return {current, pttl}
`;

export interface RedisRateLimitStoreOptions {
  client: RedisLike;
  /** Key prefix applied to every counter. Default 'verify:rl:'. */
  keyPrefix?: string;
}

export class RedisRateLimitStore implements RateLimitStore {
  private readonly client: RedisLike;
  private readonly prefix: string;

  constructor(opts: RedisRateLimitStoreOptions) {
    this.client = opts.client;
    this.prefix = opts.keyPrefix ?? 'verify:rl:';
  }

  async hit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitHit> {
    const windowMs = windowSeconds * 1000;
    const result = (await this.client.eval(
      HIT_SCRIPT,
      1,
      this.prefix + key,
      String(windowMs),
    )) as [number, number] | [string, string];
    const count = Number(result[0]);
    const ttlMs = Number(result[1]);
    return {
      count,
      limit,
      exceeded: count > limit,
      resetAt: Date.now() + ttlMs,
    };
  }
}
