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
