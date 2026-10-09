import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryVerifyStore } from './memory-verify.store.js';
import { VerificationRecord } from '../interfaces/verify-store.interface.js';

function fixture(overrides: Partial<VerificationRecord> = {}): VerificationRecord {
  const now = new Date();
  return {
    sid: 'vr_test_1',
    phone: '+14155552671',
    channel: 'sms',
    codeHash: 'deadbeef',
    salt: 'salt',
    attempts: 0,
    maxAttempts: 3,
    status: 'pending',
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    ...overrides,
  };
}

describe('MemoryVerifyStore', () => {
  let store: MemoryVerifyStore;
  beforeEach(() => {
    store = new MemoryVerifyStore();
  });

  it('round-trips a record', async () => {
    const v = fixture();
    await store.create(v);
    const got = await store.get(v.sid);
    expect(got).toMatchObject({ sid: v.sid, status: 'pending' });
  });

  it('returns null for an unknown sid', async () => {
    expect(await store.get('vr_missing')).toBeNull();
  });

  it('increments attempts atomically and reports outcome', async () => {
    await store.create(fixture({ maxAttempts: 3 }));
    const r1 = await store.incrementAttempts('vr_test_1');
    expect(r1.outcome).toBe('incremented');
    expect(r1.record?.attempts).toBe(1);
  });

  it('flips to canceled on the attempt that hits maxAttempts', async () => {
    await store.create(fixture({ attempts: 2, maxAttempts: 3 }));
    const r = await store.incrementAttempts('vr_test_1');
    expect(r.outcome).toBe('locked-out');
    expect(r.record?.status).toBe('canceled');
  });

  it('reports not-pending when status already terminal', async () => {
    await store.create(fixture({ status: 'approved' }));
    const r = await store.incrementAttempts('vr_test_1');
    expect(r.outcome).toBe('not-pending');
  });

  it('reports not-found for unknown sid', async () => {
    const r = await store.incrementAttempts('vr_missing');
    expect(r.outcome).toBe('not-found');
    expect(r.record).toBeNull();
  });

  it('markStatus succeeds only when pending', async () => {
    await store.create(fixture());
    expect(await store.markStatus('vr_test_1', 'approved')).toBe(true);
    // second attempt — no longer pending
    expect(await store.markStatus('vr_test_1', 'canceled')).toBe(false);
  });

  it('lazily flips status to expired when reading past expiresAt', async () => {
    const past = new Date(Date.now() - 1_000);
    await store.create(fixture({ expiresAt: past }));
    const r = await store.get('vr_test_1');
    expect(r?.status).toBe('expired');
  });

  it('delete removes the record', async () => {
    await store.create(fixture());
    await store.delete('vr_test_1');
    expect(await store.get('vr_test_1')).toBeNull();
  });
});

describe('MemoryVerifyStore.reserveAttempt', () => {
  const record = (over: Partial<VerificationRecord> = {}): VerificationRecord => ({
    sid: 'vr_r', phone: '+1', channel: 'sms', codeHash: 'h', salt: 's', attempts: 0, maxAttempts: 3,
    status: 'pending', createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000), ...over,
  });

  it('reserves up to maxAttempts of many simultaneous calls, never changing the status', async () => {
    const store = new MemoryVerifyStore();
    await store.create(record());
    const outcomes = (await Promise.all(Array.from({ length: 10 }, () => store.reserveAttempt('vr_r')))).map((r) => r.outcome);
    expect(outcomes.filter((o) => o === 'reserved')).toHaveLength(3);
    expect(outcomes.filter((o) => o === 'exhausted')).toHaveLength(7);
    expect(await store.get('vr_r')).toMatchObject({ attempts: 3, status: 'pending' });
  });

  it('answers not-pending and not-found', async () => {
    const store = new MemoryVerifyStore();
    await store.create(record({ status: 'approved' }));
    expect((await store.reserveAttempt('vr_r')).outcome).toBe('not-pending');
    expect((await store.reserveAttempt('nope')).outcome).toBe('not-found');
  });

  it('answers expired for a pending record past expiresAt', async () => {
    const store = new MemoryVerifyStore();
    await store.create(record({ expiresAt: new Date(Date.now() - 1) }));
    expect((await store.reserveAttempt('vr_r')).outcome).toBe('expired');
    expect((await store.get('vr_r'))!.attempts).toBe(0);
  });
});
