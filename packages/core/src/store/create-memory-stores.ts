import { MemoryVerifyStore } from './memory-verify.store.js';
import { MemoryAbuseStore } from './memory-abuse.store.js';
import { MemoryRateLimitStore } from './memory-rate-limit.store.js';
import { MemoryCooldownStore } from './memory-cooldown.store.js';
import { MemoryRecipientIndexStore } from './memory-recipient-index.store.js';

/**
 * Returns all five in-memory stores wired up. Convenience for dev, tests,
 * and single-instance demos. Not safe for multi-instance deployments.
 *
 * @example
 * VerifyModule.forRoot({
 *   sms: { provider: new MockSmsProvider() },
 *   stores: createMemoryStores(),
 * });
 */
export function createMemoryStores(): {
  verify: MemoryVerifyStore;
  abuse: MemoryAbuseStore;
  rateLimit: MemoryRateLimitStore;
  cooldown: MemoryCooldownStore;
  recipientIndex: MemoryRecipientIndexStore;
  /** @deprecated The same object as `recipientIndex`, under its pre-0.9.0 name; removed in 1.0. */
  phoneIndex: MemoryRecipientIndexStore;
} {
  const recipientIndex = new MemoryRecipientIndexStore();
  const stores = {
    verify: new MemoryVerifyStore(),
    abuse: new MemoryAbuseStore(),
    rateLimit: new MemoryRateLimitStore(),
    cooldown: new MemoryCooldownStore(),
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
    phoneIndex: MemoryRecipientIndexStore;
  };
}
