import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerifyService } from './verify.service.js';
import { createMemoryStores } from './store/create-memory-stores.js';
import { MemoryAuditSink } from './audit/memory-audit.sink.js';
import { VerifyErrorCode, VerifyException } from './errors.js';
import type { VerifyModuleOptions } from './interfaces/module-options.interface.js';
import type { SmsProvider, SmsSendParams } from './interfaces/sms-provider.interface.js';
import type { PhoneIndexStore } from './interfaces/phone-index-store.interface.js';

const CODE = '424242';
const PHONE = '+14155552671';
// A newer verification's sid, written straight into the index: the cooldown
// claim (#13) keeps a real second start out of these windows, so the tests
// stand in for one that got in anyway (a lapsed claim, cooldownSeconds 0, or
// a start after the cooldown while an older code is still valid).
const NEWER = 'vr_newer';

const provider = (behave: () => Promise<unknown> = async () => undefined) => {
  const p: SmsProvider = {
    name: 'stub',
    send: vi.fn(async (_: SmsSendParams) => {
      await behave();
      return { providerMessageId: 'stub-1', provider: 'stub' };
    }),
  };
  return p;
};

const outcome = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof VerifyException ? e.code : (e as Error).message),
  );

describe('VerifyService, index entries removed only while they hold this sid (#9)', () => {
  let stores: ReturnType<typeof createMemoryStores> & { audit: MemoryAuditSink };

  const build = (sms: SmsProvider, extra: Partial<VerifyModuleOptions> = {}) =>
    new VerifyService({ sms: { provider: sms }, stores, code: { fixedCode: CODE }, ...extra });

  beforeEach(() => {
    stores = { ...createMemoryStores(), audit: new MemoryAuditSink() };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps a newer verification's entry when a failed send cleans up (case 1)", async () => {
    const sms = provider(async () => {
      await stores.phoneIndex.set(PHONE, NEWER, 600);
      throw new Error('rejected');
    });
    const service = build(sms);
    expect(await outcome(service.start({ to: PHONE }))).toBe(VerifyErrorCode.SmsDispatchFailed);
    expect(await stores.phoneIndex.get(PHONE)).toBe(NEWER);
  });

  it('removes its own entry when a failed send cleans up', async () => {
    const service = build(provider(async () => Promise.reject(new Error('rejected'))));
    expect(await outcome(service.start({ to: PHONE }))).toBe(VerifyErrorCode.SmsDispatchFailed);
    expect(await stores.phoneIndex.get(PHONE)).toBeNull();
  });

  it('leaves no entry pointing at its deleted record after losing the claim during the index write (case 2)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const sms = provider();
    const service = build(sms, { attempts: { cooldownSeconds: 1 }, delivery: { attemptTimeoutMs: 1000, totalTimeoutMs: 1000 } });
    const set = stores.phoneIndex.set.bind(stores.phoneIndex);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    let stalledSid = '';
    vi.spyOn(stores.phoneIndex, 'set').mockImplementationOnce(async (phone, sid, ttl) => {
      stalledSid = sid;
      await gate;
      return set(phone, sid, ttl);
    });
    const first = outcome(service.start({ to: PHONE }));
    await vi.waitFor(() => expect(stalledSid).not.toBe(''));
    vi.setSystemTime(Date.now() + 60_000);
    expect(await outcome(service.start({ to: PHONE }))).toBe('ok');
    open();
    expect(await first).toBe(VerifyErrorCode.CooldownActive);
    expect(sms.send).toHaveBeenCalledTimes(1);
    // The stalled write replaced the winner's entry (#82); the loser then
    // removed it, so nothing points at the loser's deleted record.
    expect(await stores.phoneIndex.get(PHONE)).not.toBe(stalledSid);
  });

  it('removes its own entry when the second renewal errors (case 3)', async () => {
    const service = build(provider());
    const claim = stores.cooldown.claim.bind(stores.cooldown);
    vi.spyOn(stores.cooldown, 'claim')
      .mockImplementationOnce(claim)
      .mockImplementationOnce(claim)
      .mockRejectedValueOnce(new Error('cooldown down'));
    expect(await outcome(service.start({ to: PHONE }))).toBe('cooldown down');
    expect(await stores.phoneIndex.get(PHONE)).toBeNull();
  });

  it("keeps another sid's entry when the second renewal errors (case 3)", async () => {
    const service = build(provider());
    const claim = stores.cooldown.claim.bind(stores.cooldown);
    vi.spyOn(stores.cooldown, 'claim')
      .mockImplementationOnce(claim)
      .mockImplementationOnce(claim)
      .mockImplementationOnce(async () => {
        await stores.phoneIndex.set(PHONE, NEWER, 600);
        throw new Error('cooldown down');
      });
    expect(await outcome(service.start({ to: PHONE }))).toBe('cooldown down');
    expect(await stores.phoneIndex.get(PHONE)).toBe(NEWER);
  });

  it("keeps a newer verification's entry when check approves the older one (case 4)", async () => {
    const service = build(provider());
    await service.start({ to: PHONE });
    const markStatus = stores.verify.markStatus.bind(stores.verify);
    vi.spyOn(stores.verify, 'markStatus').mockImplementationOnce(async (sid, status) => {
      await stores.phoneIndex.set(PHONE, NEWER, 600);
      return markStatus(sid, status);
    });
    expect((await service.check({ to: PHONE, code: CODE })).state).toBe('approved');
    expect(await stores.phoneIndex.get(PHONE)).toBe(NEWER);
  });

  it("keeps a newer verification's entry when check locks out the older one (case 5)", async () => {
    const service = build(provider(), { attempts: { max: 1 } });
    await service.start({ to: PHONE });
    const increment = stores.verify.incrementAttempts.bind(stores.verify);
    vi.spyOn(stores.verify, 'incrementAttempts').mockImplementationOnce(async (sid) => {
      await stores.phoneIndex.set(PHONE, NEWER, 600);
      return increment(sid);
    });
    expect((await service.check({ to: PHONE, code: '000000' })).state).toBe('canceled');
    expect(await stores.phoneIndex.get(PHONE)).toBe(NEWER);
  });

  it('removes the entry on a normal approval and a normal lockout (case 6)', async () => {
    const approving = build(provider());
    await approving.start({ to: PHONE });
    await approving.check({ to: PHONE, code: CODE });
    expect(await stores.phoneIndex.get(PHONE)).toBeNull();

    stores = { ...createMemoryStores(), audit: new MemoryAuditSink() };
    const locking = build(provider(), { attempts: { max: 1 } });
    await locking.start({ to: PHONE });
    await locking.check({ to: PHONE, code: '000000' });
    expect(await stores.phoneIndex.get(PHONE)).toBeNull();
  });

  it('refuses a phone index store without deleteIfMatches on boot (case 8)', () => {
    const legacy: Omit<PhoneIndexStore, 'deleteIfMatches'> = {
      set: async () => undefined,
      get: async () => null,
      delete: async () => undefined,
    };
    stores = { ...stores, phoneIndex: legacy as unknown as typeof stores.phoneIndex };
    expect(() => build(provider())).toThrow('stores.phoneIndex must implement deleteIfMatches');
  });

  it("keeps a newer entry when an index write saved and then reported an error (case 10)", async () => {
    const service = build(provider());
    const set = stores.phoneIndex.set.bind(stores.phoneIndex);
    vi.spyOn(stores.phoneIndex, 'set').mockImplementationOnce(async (phone, sid, ttl) => {
      await set(phone, sid, ttl);
      await set(phone, NEWER, 600);
      throw new Error('index reply lost');
    });
    expect(await outcome(service.start({ to: PHONE }))).toBe('index reply lost');
    expect(await stores.phoneIndex.get(PHONE)).toBe(NEWER);
  });

  it('removes its own entry when an index write saved and then reported an error (case 11)', async () => {
    const service = build(provider());
    const set = stores.phoneIndex.set.bind(stores.phoneIndex);
    vi.spyOn(stores.phoneIndex, 'set').mockImplementationOnce(async (phone, sid, ttl) => {
      await set(phone, sid, ttl);
      throw new Error('index reply lost');
    });
    expect(await outcome(service.start({ to: PHONE }))).toBe('index reply lost');
    expect(await stores.phoneIndex.get(PHONE)).toBeNull();
  });

  it('indexes for the time left on the record, not a full TTL from a later moment (case 12)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const service = build(provider(), { code: { fixedCode: CODE, ttlSeconds: 600 } });
    const create = stores.verify.create.bind(stores.verify);
    vi.spyOn(stores.verify, 'create').mockImplementationOnce(async (record) => {
      vi.setSystemTime(Date.now() + 100_000);
      return create(record);
    });
    const set = vi.spyOn(stores.phoneIndex, 'set');
    await service.start({ to: PHONE });
    expect(set.mock.calls[0][2]).toBe(500);
  });

  it('indexes for at least 1 s when the record expired during the store writes (review)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const service = build(provider(), { code: { fixedCode: CODE, ttlSeconds: 60 } });
    const create = stores.verify.create.bind(stores.verify);
    vi.spyOn(stores.verify, 'create').mockImplementationOnce(async (record) => {
      vi.setSystemTime(Date.now() + 90_000);
      return create(record);
    });
    const set = vi.spyOn(stores.phoneIndex, 'set');
    await service.start({ to: PHONE });
    expect(set.mock.calls[0][2]).toBe(1);
  });

  it('answers an approval even when the index store throws synchronously (review)', async () => {
    const service = build(provider());
    await service.start({ to: PHONE });
    vi.spyOn(stores.phoneIndex, 'deleteIfMatches').mockImplementation(() => {
      throw new Error('sync boom');
    });
    expect((await service.check({ to: PHONE, code: CODE })).state).toBe('approved');
  });

  it('answers a lockout even when the index cleanup fails (review)', async () => {
    const service = build(provider(), { attempts: { max: 1 } });
    await service.start({ to: PHONE });
    vi.spyOn(stores.phoneIndex, 'deleteIfMatches').mockRejectedValue(new Error('index down'));
    expect((await service.check({ to: PHONE, code: '000000' })).state).toBe('canceled');
  });

  it('removes the entry when check finds the record missing or already finished (review)', async () => {
    const service = build(provider());
    await service.start({ to: PHONE });
    const sid = (await stores.phoneIndex.get(PHONE))!;
    await stores.verify.markStatus(sid, 'canceled');
    expect((await service.check({ to: PHONE, code: CODE })).state).toBe('canceled');
    expect(await stores.phoneIndex.get(PHONE)).toBeNull();

    await stores.phoneIndex.set(PHONE, 'vr_gone', 600);
    expect(await outcome(service.check({ to: PHONE, code: CODE }))).toBe(VerifyErrorCode.NoPendingVerification);
    expect(await stores.phoneIndex.get(PHONE)).toBeNull();
  });

  it('removes the entry when check finds the record expired (case 13)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const service = build(provider(), { code: { fixedCode: CODE, ttlSeconds: 60 } });
    await service.start({ to: PHONE });
    const sid = await stores.phoneIndex.get(PHONE);
    const record = await stores.verify.get(sid!);
    // Keep the entry past the record's expiry, and read the record back still
    // pending as the Postgres store does (the memory store marks it expired on
    // read, which takes check down the finished-record path instead).
    await stores.phoneIndex.set(PHONE, sid!, 600);
    vi.spyOn(stores.verify, 'get').mockResolvedValueOnce({ ...record!, status: 'pending' });
    vi.setSystemTime(Date.now() + 120_000);
    expect(await outcome(service.check({ to: PHONE, code: CODE }))).toBe(VerifyErrorCode.CodeExpired);
    expect(await stores.phoneIndex.get(PHONE)).toBeNull();
  });
});
