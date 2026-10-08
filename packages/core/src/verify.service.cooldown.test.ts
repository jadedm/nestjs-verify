import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerifyService } from './verify.service.js';
import { createMemoryStores } from './store/create-memory-stores.js';
import { MemoryAuditSink } from './audit/memory-audit.sink.js';
import { VerifyErrorCode, VerifyException } from './errors.js';
import type { VerifyModuleOptions } from './interfaces/module-options.interface.js';
import type { SmsProvider, SmsSendParams } from './interfaces/sms-provider.interface.js';
import type { CooldownStore } from './interfaces/cooldown-store.interface.js';

const CODE = '424242';
const PHONE = '+14155552671';
const OTHER = '+14155552672';

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

const after = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const outcome = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof VerifyException ? e.code : (e as Error).message),
  );

const failure = async (p: Promise<unknown>) => {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(VerifyException);
  return err as VerifyException & { extras: { retryAfterMs?: number } };
};

describe('VerifyService, atomic cooldown claim (#13)', () => {
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

  it('lets one of two simultaneous starts send (case 1)', async () => {
    const sms = provider(() => after(30));
    const service = build(sms);
    const results = await Promise.all([outcome(service.start({ to: PHONE })), outcome(service.start({ to: PHONE }))]);
    expect(results.sort()).toEqual([VerifyErrorCode.CooldownActive, 'ok'].sort());
    expect(sms.send).toHaveBeenCalledTimes(1);
  });

  it('gives the claim back when a rate limit refuses the start (case 3)', async () => {
    const sms = provider();
    const service = build(sms, { rateLimit: { perIp: { count: 1, windowSeconds: 60 } } });
    await service.start({ to: PHONE, ip: '10.0.0.1' });
    expect(await outcome(service.start({ to: OTHER, ip: '10.0.0.1' }))).toBe(VerifyErrorCode.IpRateLimited);
    expect(await stores.cooldown.remaining(OTHER)).toBe(0);
    expect(await outcome(service.start({ to: OTHER, ip: '10.0.0.2' }))).toBe('ok');
  });

  it('gives the claim back when the abuse check refuses the start (review)', async () => {
    const service = build(provider());
    vi.spyOn(service as unknown as { enforceAbuseHeuristics: () => Promise<void> }, 'enforceAbuseHeuristics').mockRejectedValueOnce(
      new Error('abuse refused'),
    );
    expect(await outcome(service.start({ to: PHONE }))).toBe('abuse refused');
    expect(await stores.cooldown.remaining(PHONE)).toBe(0);
  });

  it('gives the claim back when the record cannot be written (review)', async () => {
    const service = build(provider());
    vi.spyOn(stores.verify, 'create').mockRejectedValueOnce(new Error('verify down'));
    expect(await outcome(service.start({ to: PHONE }))).toBe('verify down');
    expect(await stores.cooldown.remaining(PHONE)).toBe(0);
  });

  it('leaves the index alone when the second renewal errors (review)', async () => {
    const service = build(provider());
    const claim = stores.cooldown.claim.bind(stores.cooldown);
    vi.spyOn(stores.cooldown, 'claim')
      .mockImplementationOnce(claim)
      .mockImplementationOnce(claim)
      .mockRejectedValueOnce(new Error('cooldown down'));
    const indexDelete = vi.spyOn(stores.phoneIndex, 'delete');
    expect(await outcome(service.start({ to: PHONE }))).toBe('cooldown down');
    expect(indexDelete).not.toHaveBeenCalled();
    expect(await stores.cooldown.remaining(PHONE)).toBe(0);
  });

  it('answers with the rate limit even when giving the claim back fails (case 18)', async () => {
    const sms = provider();
    const service = build(sms, { rateLimit: { perIp: { count: 1, windowSeconds: 60 } } });
    await service.start({ to: PHONE, ip: '10.0.0.1' });
    vi.spyOn(stores.cooldown, 'release').mockRejectedValue(new Error('store down'));
    expect(await outcome(service.start({ to: OTHER, ip: '10.0.0.1' }))).toBe(VerifyErrorCode.IpRateLimited);
  });

  it('gives the claim back when the send definitely failed, so a retry sends (case 4)', async () => {
    let fail = true;
    const sms = provider(async () => {
      if (fail) throw new Error('rejected');
    });
    const service = build(sms);
    const err = await failure(service.start({ to: PHONE }));
    expect(err.code).toBe(VerifyErrorCode.SmsDispatchFailed);
    expect(err.extras.retryAfterMs).toBeUndefined();
    expect(await stores.cooldown.remaining(PHONE)).toBe(0);
    fail = false;
    expect(await outcome(service.start({ to: PHONE }))).toBe('ok');
    expect(sms.send).toHaveBeenCalledTimes(2);
  });

  it('keeps the cooldown after a send, and a late release by its sid does not end it (case 7)', async () => {
    const service = build(provider());
    const res = await service.start({ to: PHONE });
    await stores.cooldown.release(PHONE, res.sid);
    expect(await stores.cooldown.remaining(PHONE)).toBeGreaterThan(29_000);
    expect(await outcome(service.start({ to: PHONE }))).toBe(VerifyErrorCode.CooldownActive);
  });

  it('claims for the send window plus a margin for the store writes (case 10)', async () => {
    const claim = vi.spyOn(stores.cooldown, 'claim');
    const service = build(provider(), { attempts: { cooldownSeconds: 1 }, delivery: { totalTimeoutMs: 10_000 } });
    await service.start({ to: PHONE });
    // Claimed, renewed after the record, renewed before the send.
    expect(claim.mock.calls.map((c) => c[1])).toEqual([40, 40, 40]);
  });

  it('claims for the cooldown when it is longer than the send window and margin', async () => {
    const claim = vi.spyOn(stores.cooldown, 'claim');
    const service = build(provider(), { attempts: { cooldownSeconds: 120 } });
    await service.start({ to: PHONE });
    expect(claim.mock.calls.map((c) => c[1])).toEqual([120, 120, 120]);
  });

  it('releases the claim only after its cleanup, so a start in between keeps its index entry (review)', async () => {
    let fail = true;
    const sms = provider(async () => {
      if (fail) throw new Error('rejected');
    });
    const service = build(sms);
    const del = stores.verify.delete.bind(stores.verify);
    let second: Promise<string> | undefined;
    vi.spyOn(stores.verify, 'delete').mockImplementationOnce(async (sid) => {
      // A start arriving while the failed start is still cleaning up.
      fail = false;
      second = outcome(service.start({ to: PHONE }));
      await after(20);
      return del(sid);
    });
    expect(await outcome(service.start({ to: PHONE }))).toBe(VerifyErrorCode.SmsDispatchFailed);
    expect(await second).toBe(VerifyErrorCode.CooldownActive);
    // Nothing was sent for the refused start, and a retry after the cleanup sends.
    expect(await outcome(service.start({ to: PHONE }))).toBe('ok');
    expect((await service.check({ to: PHONE, code: CODE })).state).toBe('approved');
  });

  it('takes no claim when cooldownSeconds is 0 (case 11)', async () => {
    const claim = vi.spyOn(stores.cooldown, 'claim');
    const sms = provider(() => after(10));
    const service = build(sms, { attempts: { cooldownSeconds: 0 } });
    const results = await Promise.all([outcome(service.start({ to: PHONE })), outcome(service.start({ to: PHONE }))]);
    expect(results).toEqual(['ok', 'ok']);
    expect(claim).not.toHaveBeenCalled();
  });

  it('refuses a cooldown store without claim and release on boot (case 12)', () => {
    const legacy: Pick<CooldownStore, 'remaining' | 'start'> = { remaining: async () => 0, start: async () => undefined };
    stores = { ...stores, cooldown: legacy as unknown as typeof stores.cooldown };
    expect(() => build(provider())).toThrow('stores.cooldown must implement claim and release');
  });

  it('stops a start whose claim lapsed during slow store writes (case 16)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const sms = provider();
    // 31 s claim: cooldown 1 s, a 1 s send window and the 30 s margin.
    const service = build(sms, { attempts: { cooldownSeconds: 1 }, delivery: { attemptTimeoutMs: 1000, totalTimeoutMs: 1000 } });
    const create = stores.verify.create.bind(stores.verify);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const deleted = vi.spyOn(stores.verify, 'delete');
    vi.spyOn(stores.verify, 'create').mockImplementationOnce(async (record) => {
      await gate;
      return create(record);
    });

    const first = outcome(service.start({ to: PHONE }));
    await vi.waitFor(() => expect(stores.verify.create).toHaveBeenCalledTimes(1));
    vi.setSystemTime(Date.now() + 60_000);
    expect(await outcome(service.start({ to: PHONE }))).toBe('ok');
    open();
    expect(await first).toBe(VerifyErrorCode.CooldownActive);

    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(deleted).toHaveBeenCalledTimes(1);
    // The second start's index entry survived, so its code still checks.
    expect((await service.check({ to: PHONE, code: CODE })).state).toBe('approved');
  });

  it('does not send when the claim lapsed during the index write (case 16b)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const sms = provider();
    const service = build(sms, { attempts: { cooldownSeconds: 1 }, delivery: { attemptTimeoutMs: 1000, totalTimeoutMs: 1000 } });
    const set = stores.phoneIndex.set.bind(stores.phoneIndex);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    vi.spyOn(stores.phoneIndex, 'set').mockImplementationOnce(async (phone, sid, ttl) => {
      await gate;
      return set(phone, sid, ttl);
    });

    const first = outcome(service.start({ to: PHONE }));
    await vi.waitFor(() => expect(stores.phoneIndex.set).toHaveBeenCalledTimes(1));
    vi.setSystemTime(Date.now() + 60_000);
    expect(await outcome(service.start({ to: PHONE }))).toBe('ok');
    open();
    expect(await first).toBe(VerifyErrorCode.CooldownActive);
    expect(sms.send).toHaveBeenCalledTimes(1);
  });

  it('deletes the record and gives the claim back when the index write fails (case 20)', async () => {
    const service = build(provider());
    vi.spyOn(stores.phoneIndex, 'set').mockRejectedValueOnce(new Error('index down'));
    const deleted = vi.spyOn(stores.verify, 'delete');
    expect(await outcome(service.start({ to: PHONE }))).toBe('index down');
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(await stores.cooldown.remaining(PHONE)).toBe(0);
  });

  it('deletes the record and gives the claim back when renewing the claim fails', async () => {
    const service = build(provider());
    const claim = stores.cooldown.claim.bind(stores.cooldown);
    vi.spyOn(stores.cooldown, 'claim')
      .mockImplementationOnce(claim)
      .mockRejectedValueOnce(new Error('cooldown down'));
    const deleted = vi.spyOn(stores.verify, 'delete');
    expect(await outcome(service.start({ to: PHONE }))).toBe('cooldown down');
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(await stores.cooldown.remaining(PHONE)).toBe(0);
  });
});
