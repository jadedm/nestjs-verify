import { describe, expect, it } from 'vitest';
import type { Db } from 'mongodb';
import { MongoRecipientIndexStore } from './mongo-recipient-index.store.js';

// A collection that plays back scripted answers, so each branch of the retry
// after a lost insert race (#82) runs deterministically. The adapter smoke
// covers the real database; there the race is hit only by chance.
const duplicateId = Object.assign(new Error('E11000 duplicate key error'), { code: 11000, keyPattern: { _id: 1 } });

type Step = { upsert?: 'ok' | 'duplicate' | Error; update?: number; found?: boolean };

const scripted = (steps: Step[]) => {
  const calls: string[] = [];
  let i = 0;
  const step = () => steps[Math.min(i, steps.length - 1)];
  const col = {
    async updateOne(_filter: unknown, _update: unknown, opts?: { upsert?: boolean }) {
      if (opts?.upsert) {
        calls.push('upsert');
        const outcome = step().upsert;
        if (outcome === 'duplicate') throw duplicateId;
        if (outcome instanceof Error) throw outcome;
        i += 1;
        return { matchedCount: 0, upsertedCount: 1 };
      }
      calls.push('update');
      return { matchedCount: step().update ?? 0 };
    },
    async findOne() {
      calls.push('findOne');
      const found = step().found;
      i += 1;
      return found ? { _id: 'x' } : null;
    },
  };
  const db = { collection: () => col } as unknown as Db;
  return { store: new MongoRecipientIndexStore({ db }), calls };
};

const at = new Date(1_700_000_000_000);

describe('MongoRecipientIndexStore.set after a lost insert race (#82)', () => {
  it('writes with the upsert when it does not race', async () => {
    const { store, calls } = scripted([{ upsert: 'ok' }]);
    await store.set('+91999', 'vr_a', 60, at);
    expect(calls).toEqual(['upsert']);
  });

  it('replaces the winner of the race when it is not newer', async () => {
    const { store, calls } = scripted([{ upsert: 'duplicate', update: 1 }]);
    await store.set('+91999', 'vr_a', 60, at);
    expect(calls).toEqual(['upsert', 'update']);
  });

  it('keeps the winner of the race when it is newer', async () => {
    const { store, calls } = scripted([{ upsert: 'duplicate', update: 0, found: true }]);
    await store.set('+91999', 'vr_a', 60, at);
    expect(calls).toEqual(['upsert', 'update', 'findOne']);
  });

  it('inserts after all when the winner is gone again before the retry', async () => {
    const { store, calls } = scripted([{ upsert: 'duplicate', update: 0, found: false }, { upsert: 'ok' }]);
    await store.set('+91999', 'vr_a', 60, at);
    expect(calls).toEqual(['upsert', 'update', 'findOne', 'upsert']);
  });

  it('gives up with an error after three rounds rather than looping', async () => {
    const { store, calls } = scripted([{ upsert: 'duplicate', update: 0, found: false }]);
    await expect(store.set('+91999', 'vr_a', 60, at)).rejects.toThrow('the index entry was not written after 3 attempts');
    expect(calls.filter((c) => c === 'upsert')).toHaveLength(3);
  });

  it('throws a duplicate key on another index', async () => {
    const other = Object.assign(new Error('E11000 duplicate key error'), { code: 11000, keyPattern: { sid: 1 } });
    const { store } = scripted([{ upsert: other }]);
    await expect(store.set('+91999', 'vr_a', 60, at)).rejects.toThrow('E11000');
  });
});
