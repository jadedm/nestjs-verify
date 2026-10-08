import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryCooldownStore } from './memory-cooldown.store.js';

describe('MemoryCooldownStore', () => {
  let store: MemoryCooldownStore;
  beforeEach(() => {
    store = new MemoryCooldownStore();
  });

  it('reports 0 remaining for an unknown key', async () => {
    expect(await store.remaining('k')).toBe(0);
  });

  it('reports positive remaining after start', async () => {
    await store.start('k', 60);
    const ms = await store.remaining('k');
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(60_000);
  });

  it('reports 0 once the cooldown has elapsed', async () => {
    await store.start('k', 0);
    expect(await store.remaining('k')).toBe(0);
  });

  it('start overwrites an existing cooldown', async () => {
    await store.start('k', 60);
    await store.start('k', 10);
    const ms = await store.remaining('k');
    expect(ms).toBeLessThanOrEqual(10_000);
  });
});

describe('MemoryCooldownStore claim and release (#13)', () => {
  let store: MemoryCooldownStore;
  beforeEach(() => {
    store = new MemoryCooldownStore();
  });

  it('lets exactly one of many simultaneous claims win', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => store.claim('k', 60, `h${i}`)));
    expect(results.filter((ms) => ms === 0)).toHaveLength(1);
    expect(results.filter((ms) => ms > 0)).toHaveLength(9);
  });

  it('renews for the same holder (case 17)', async () => {
    expect(await store.claim('k', 1, 'a')).toBe(0);
    expect(await store.claim('k', 60, 'a')).toBe(0);
    expect(await store.remaining('k')).toBeGreaterThan(1_000);
  });

  it('takes an expired claim (case 9)', async () => {
    expect(await store.claim('k', 0, 'a')).toBe(0);
    expect(await store.claim('k', 60, 'b')).toBe(0);
  });

  it('ignores a release by another holder (case 8)', async () => {
    await store.claim('k', 60, 'a');
    await store.release('k', 'b');
    expect(await store.claim('k', 60, 'b')).toBeGreaterThan(0);
    await store.release('k', 'a');
    expect(await store.claim('k', 60, 'b')).toBe(0);
  });

  it('cannot release a cooldown started after the claim', async () => {
    await store.claim('k', 60, 'a');
    await store.start('k', 60);
    await store.release('k', 'a');
    expect(await store.remaining('k')).toBeGreaterThan(0);
  });
});
