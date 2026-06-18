import type { RedisLike } from './redis-like.interface.js';
import { RedisRateLimitStore } from './redis-rate-limit.store.js';
import { RedisCooldownStore } from './redis-cooldown.store.js';
import { RedisPhoneIndexStore } from './redis-phone-index.store.js';

export interface CreateRedisStoresOptions {
  client: RedisLike;
  /** Optional global key prefix; overrides each store's default. */
  keyPrefix?: string;
}

export interface RedisStores {
  rateLimit: RedisRateLimitStore;
  cooldown: RedisCooldownStore;
  phoneIndex: RedisPhoneIndexStore;
}

/**
 * Construct the three ephemeral stores backed by Redis. Pair with a
 * durable store (Postgres or Mongo) for `verify` and `abuse`.
 *
 * Verify and Abuse stores are NOT provided by this package because Redis
 * is volatile by default. Losing in-flight verification records to a
 * Redis restart is unacceptable; losing rate limit counters is.
 *
 * @example
 * import Redis from 'ioredis';
 * const redis = new Redis(process.env.REDIS_URL!);
 * const { rateLimit, cooldown, phoneIndex } = createRedisStores({ client: redis });
 */
export function createRedisStores(
  opts: CreateRedisStoresOptions,
): RedisStores {
  return {
    rateLimit: new RedisRateLimitStore({
      client: opts.client,
      keyPrefix: opts.keyPrefix ? opts.keyPrefix + 'rl:' : undefined,
    }),
    cooldown: new RedisCooldownStore({
      client: opts.client,
      keyPrefix: opts.keyPrefix ? opts.keyPrefix + 'cd:' : undefined,
    }),
    phoneIndex: new RedisPhoneIndexStore({
      client: opts.client,
      keyPrefix: opts.keyPrefix ? opts.keyPrefix + 'idx:' : undefined,
    }),
  };
}
