import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerifyService } from './verify.service.js';
import { createMemoryStores } from './store/create-memory-stores.js';
import { MockSmsProvider } from './providers/mock-sms.provider.js';
import type { VerifyModuleOptions } from './interfaces/module-options.interface.js';

const CODE = '424242';
const PHONE = '+14155552671';

describe('VerifyService, the store that judges a deadline sets it (#108)', () => {
  let stores: ReturnType<typeof createMemoryStores>;
  const build = (extra: Partial<VerifyModuleOptions> = {}) =>
    new VerifyService({
      sms: { provider: new MockSmsProvider({ logToConsole: false }) },
      stores,
      code: { fixedCode: CODE, ttlSeconds: 120 },
      ...extra,
    });

  beforeEach(() => {
    stores = createMemoryStores();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes the TTL to create and answers with the deadline the store returns', async () => {
    const storeDeadline = new Date(Date.now() + 3_600_000 + 120_000);
    const create = vi.spyOn(stores.verify, 'create').mockResolvedValue(storeDeadline);
    const result = await build().start({ to: PHONE });
    expect(create.mock.calls[0][1]).toBe(120);
    expect(result.expiresAt).toEqual(storeDeadline);
  });

  it('keeps the deadline it computed when the store returns nothing (a store written before 0.9.0)', async () => {
    vi.spyOn(stores.verify, 'create').mockResolvedValue(undefined);
    const before = Date.now();
    const result = await build().start({ to: PHONE });
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 120_000);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 120_000);
  });

  it('does not shorten the index entry by time spent before the store set its deadline (codex review)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const create = stores.verify.create.bind(stores.verify);
    vi.spyOn(stores.verify, 'create').mockImplementation(async (v, ttl?: number) => {
      vi.setSystemTime(Date.now() + 30_000);
      await create(v, ttl);
      return new Date(Date.now() + 120_000);
    });
    const set = vi.spyOn(stores.recipientIndex, 'set');
    await build().start({ to: PHONE });
    vi.useRealTimers();
    expect(set.mock.calls[0][2]).toBe(120);
  });

  it('gives the index entry the TTL less the time this start has spent, not the store deadline less this clock', async () => {
    // A store deadline an hour ahead of this clock must not stretch the entry.
    const create = stores.verify.create.bind(stores.verify);
    vi.spyOn(stores.verify, 'create').mockImplementation(async (v, ttl?: number) => {
      await create(v, ttl);
      return new Date(Date.now() + 3_600_000);
    });
    const set = vi.spyOn(stores.recipientIndex, 'set');
    await build().start({ to: PHONE });
    const ttl = set.mock.calls[0][2];
    expect(ttl).toBeGreaterThanOrEqual(119);
    expect(ttl).toBeLessThanOrEqual(120);
  });
});
