import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRateLimitStore } from './memory-rate-limit.store.js';

describe('MemoryRateLimitStore', () => {
  let store: MemoryRateLimitStore;
  beforeEach(() => {
    store = new MemoryRateLimitStore();
  });

  it('increments within window', async () => {
    const a = await store.hit('k', 5, 60);
    expect(a).toMatchObject({ count: 1, limit: 5, exceeded: false });
    const b = await store.hit('k', 5, 60);
    expect(b.count).toBe(2);
    expect(b.exceeded).toBe(false);
  });

  it('reports exceeded once count > limit', async () => {
    for (let i = 0; i < 5; i++) await store.hit('k', 5, 60);
    const sixth = await store.hit('k', 5, 60);
    expect(sixth.count).toBe(6);
    expect(sixth.exceeded).toBe(true);
  });

  it('isolates counters by key', async () => {
    await store.hit('a', 5, 60);
    const b = await store.hit('b', 5, 60);
    expect(b.count).toBe(1);
  });

  it('resets count when window has expired', async () => {
    // window of 1 ms past
    await store.hit('k', 5, 0);
    // First hit set resetAt to "now + 0ms" so it's already in the past.
    // Next hit should start a fresh window.
    const next = await store.hit('k', 5, 60);
    expect(next.count).toBe(1);
    expect(next.exceeded).toBe(false);
  });

  it('returns resetAt as a unix ms timestamp in the future', async () => {
    const before = Date.now();
    const r = await store.hit('k', 5, 60);
    expect(r.resetAt).toBeGreaterThan(before);
    expect(r.resetAt).toBeLessThanOrEqual(before + 60_000 + 100);
  });
});
