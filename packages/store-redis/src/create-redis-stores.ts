import type { RedisLike } from './redis-like.interface.js';
import { RedisRateLimitStore } from './redis-rate-limit.store.js';
import { RedisCooldownStore } from './redis-cooldown.store.js';
import { RedisRecipientIndexStore } from './redis-recipient-index.store.js';

export interface CreateRedisStoresOptions {
  client: RedisLike;
  /** Optional global key prefix; overrides each store's default. */
  keyPrefix?: string;
}

export interface RedisStores {
  rateLimit: RedisRateLimitStore;
  cooldown: RedisCooldownStore;
  recipientIndex: RedisRecipientIndexStore;
  /** @deprecated The same object as `recipientIndex`, under its pre-0.9.0 name; removed in 1.0. */
  phoneIndex: RedisRecipientIndexStore;
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
 * const { rateLimit, cooldown, recipientIndex } = createRedisStores({ client: redis });
 */
export function createRedisStores(
  opts: CreateRedisStoresOptions,
): RedisStores {
  const recipientIndex = new RedisRecipientIndexStore({
    client: opts.client,
    keyPrefix: opts.keyPrefix ? opts.keyPrefix + 'idx:' : undefined,
  });
  const stores = {
    rateLimit: new RedisRateLimitStore({
      client: opts.client,
      keyPrefix: opts.keyPrefix ? opts.keyPrefix + 'rl:' : undefined,
    }),
    cooldown: new RedisCooldownStore({
      client: opts.client,
      keyPrefix: opts.keyPrefix ? opts.keyPrefix + 'cd:' : undefined,
    }),
    recipientIndex,
  };
  // `phoneIndex`, the pre-0.9.0 name (#8), reads and writes `recipientIndex`,
  // so the two cannot disagree on this object, however it is changed. It is
  // not enumerable, so a spread such as `{ ...stores, recipientIndex: other }`
  // leaves it out. The type still lists it; on a spread copy it is undefined.
  return Object.defineProperty(stores, 'phoneIndex', {
    get: () => stores.recipientIndex,
    set: (store) => {
      stores.recipientIndex = store;
    },
    enumerable: false,
    configurable: true,
  }) as typeof stores & {
    phoneIndex: typeof recipientIndex;
  };
}
