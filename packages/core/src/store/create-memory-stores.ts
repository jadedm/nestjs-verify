import { MemoryVerifyStore } from './memory-verify.store.js';
import { MemoryAbuseStore } from './memory-abuse.store.js';
import { MemoryRateLimitStore } from './memory-rate-limit.store.js';
import { MemoryCooldownStore } from './memory-cooldown.store.js';
import { MemoryPhoneIndexStore } from './memory-phone-index.store.js';

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
  phoneIndex: MemoryPhoneIndexStore;
} {
  return {
    verify: new MemoryVerifyStore(),
    abuse: new MemoryAbuseStore(),
    rateLimit: new MemoryRateLimitStore(),
    cooldown: new MemoryCooldownStore(),
    phoneIndex: new MemoryPhoneIndexStore(),
  };
}
