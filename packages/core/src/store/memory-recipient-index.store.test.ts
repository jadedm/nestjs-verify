import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRecipientIndexStore } from './memory-recipient-index.store.js';

describe('MemoryRecipientIndexStore', () => {
  let store: MemoryRecipientIndexStore;
  beforeEach(() => {
    store = new MemoryRecipientIndexStore();
  });

  it('round-trips a set then get', async () => {
    await store.set('+91999', 'vr_1', 60);
    expect(await store.get('+91999')).toBe('vr_1');
  });

  it('returns null for an unknown phone', async () => {
    expect(await store.get('+91888')).toBeNull();
  });

  it('returns null once the TTL has elapsed', async () => {
    await store.set('+91999', 'vr_1', 0);
    expect(await store.get('+91999')).toBeNull();
  });

  it('set overwrites the prior mapping for the same phone', async () => {
    await store.set('+91999', 'vr_1', 60);
    await store.set('+91999', 'vr_2', 60);
    expect(await store.get('+91999')).toBe('vr_2');
  });

  it('delete removes the mapping', async () => {
    await store.set('+91999', 'vr_1', 60);
    await store.delete('+91999');
    expect(await store.get('+91999')).toBeNull();
  });
});

describe('MemoryRecipientIndexStore.deleteIfMatches (#9)', () => {
  it('removes the entry only while it holds the sid', async () => {
    const store = new MemoryRecipientIndexStore();
    await store.set('+1', 'vr_a', 60);
    await store.deleteIfMatches('+1', 'vr_b');
    expect(await store.get('+1')).toBe('vr_a');
    await store.deleteIfMatches('+1', 'vr_a');
    expect(await store.get('+1')).toBeNull();
    await store.deleteIfMatches('+1', 'vr_a');
    expect(await store.get('+1')).toBeNull();
  });
});
