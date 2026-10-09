import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerifyService } from './verify.service.js';
import { createMemoryStores } from './store/create-memory-stores.js';
import { MemoryAuditSink } from './audit/memory-audit.sink.js';
import { MockSmsProvider } from './providers/mock-sms.provider.js';
import type { VerifyModuleOptions } from './interfaces/module-options.interface.js';
import type { ReserveResult, VerifyStore } from './interfaces/verify-store.interface.js';

const CODE = '424242';
const PHONE = '+14155552671';
const wrong = (i: number) => String(100000 + i);

const outcome = (p: Promise<{ state: string }>) =>
  p.then(
    (r) => r.state,
    (e: unknown) => (e as { code?: string }).code ?? (e as Error).message,
  );

describe('VerifyService, attempts counted before the code is compared', () => {
  let stores: ReturnType<typeof createMemoryStores> & { audit: MemoryAuditSink };

  const build = (extra: Partial<VerifyModuleOptions> = {}) =>
    new VerifyService({
      sms: { provider: new MockSmsProvider({ logToConsole: false }) },
      stores,
      code: { fixedCode: CODE },
      attempts: { max: 3, cooldownSeconds: 0 },
      ...extra,
    });

  beforeEach(() => {
    stores = { ...createMemoryStores(), audit: new MemoryAuditSink() };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('compares at most maxAttempts codes from a burst of simultaneous checks', async () => {
    const service = build();
    await service.start({ to: PHONE });
    // Every check reads the record before any of them reserves an attempt,
    // the interleaving that let a burst compare more codes than maxAttempts.
    const get = stores.verify.get.bind(stores.verify);
    let release!: () => void;
    const allRead = new Promise<void>((r) => (release = r));
    let reads = 0;
    vi.spyOn(stores.verify, 'get').mockImplementation(async (sid) => {
      const record = await get(sid);
      reads += 1;
      if (reads === 20) release();
      await allRead;
      return record;
    });
    const reserve = stores.verify.reserveAttempt.bind(stores.verify);
    const reservations: ReserveResult['outcome'][] = [];
    vi.spyOn(stores.verify, 'reserveAttempt').mockImplementation(async (sid) => {
      const r = await reserve(sid);
      reservations.push(r.outcome);
      return r;
    });

    // The right code is the 11th guess, after 10 wrong ones in the same burst.
    const codes = Array.from({ length: 20 }, (_, i) => (i === 10 ? CODE : wrong(i)));
    const results = await Promise.all(codes.map((code) => outcome(service.check({ to: PHONE, code }))));

    expect(reservations.filter((o) => o === 'reserved')).toHaveLength(3);
    expect(results[10]).toBe('canceled');
    expect(results.filter((r) => r === 'approved')).toHaveLength(0);
    const sid = (await stores.audit.events.find((e) => e.type === 'verification_started'))!.sid!;
    const stored = await get(sid);
    expect(stored).toMatchObject({ attempts: 3, status: 'canceled' });
  });

  it('accepts the right code on the last allowed attempt', async () => {
    const service = build();
    await service.start({ to: PHONE });
    expect(await outcome(service.check({ to: PHONE, code: wrong(1) }))).toBe('pending');
    expect(await outcome(service.check({ to: PHONE, code: wrong(2) }))).toBe('pending');
    expect(await outcome(service.check({ to: PHONE, code: CODE }))).toBe('approved');
  });

  it('locks out on the last wrong code, and compares nothing after it', async () => {
    const service = build();
    await service.start({ to: PHONE });
    const remaining = [];
    for (const i of [1, 2]) {
      const r = await service.check({ to: PHONE, code: wrong(i) });
      remaining.push(r.attemptsRemaining);
    }
    expect(remaining).toEqual([2, 1]);
    expect(await outcome(service.check({ to: PHONE, code: wrong(3) }))).toBe('canceled');
    const sid = (await stores.audit.events.find((e) => e.type === 'verification_started'))!.sid!;
    expect((await stores.verify.get(sid))!.status).toBe('canceled');
    expect(await outcome(service.check({ to: PHONE, code: CODE }))).toBe('NO_PENDING_VERIFICATION');
  });

  it('answers canceled without comparing or writing when every attempt is held by other checks', async () => {
    const service = build();
    await service.start({ to: PHONE });
    const sid = (await stores.phoneIndex.get(PHONE))!;
    for (let i = 0; i < 3; i++) await stores.verify.reserveAttempt(sid);
    const markStatus = vi.spyOn(stores.verify, 'markStatus');
    expect(await outcome(service.check({ to: PHONE, code: CODE }))).toBe('canceled');
    expect(markStatus).not.toHaveBeenCalled();
    expect((await stores.verify.get(sid))!.status).toBe('pending');
  });

  it('approves a right code sent twice at once on the last attempt (review)', async () => {
    const service = build();
    await service.start({ to: PHONE });
    await service.check({ to: PHONE, code: wrong(1) });
    await service.check({ to: PHONE, code: wrong(2) });
    // The reserving request's approval lands after the other request is refused.
    const markStatus = stores.verify.markStatus.bind(stores.verify);
    vi.spyOn(stores.verify, 'markStatus').mockImplementation(async (sid, status) => {
      if (status === 'approved') await new Promise((r) => setTimeout(r, 20));
      return markStatus(sid, status);
    });
    const results = await Promise.all([outcome(service.check({ to: PHONE, code: CODE })), outcome(service.check({ to: PHONE, code: CODE }))]);
    expect(results.sort()).toEqual(['approved', 'canceled']);
  });

  it('refuses a record that expires between the read and the reservation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const service = build({ code: { fixedCode: CODE, ttlSeconds: 60 } });
    await service.start({ to: PHONE });
    // The service's own expiry check passes; the clock moves on before the
    // store reserves, so only the reservation sees the record as expired.
    const reserve = stores.verify.reserveAttempt.bind(stores.verify);
    vi.spyOn(stores.verify, 'reserveAttempt').mockImplementationOnce(async (sid) => {
      vi.setSystemTime(Date.now() + 120_000);
      return reserve(sid);
    });
    expect(await outcome(service.check({ to: PHONE, code: CODE }))).toBe('CODE_EXPIRED');
    const sid = (await stores.audit.events.find((e) => e.type === 'verification_started'))!.sid!;
    expect((await stores.verify.get(sid))!).toMatchObject({ status: 'expired', attempts: 0 });
    vi.useRealTimers();
  });

  it('refuses a code past the deadline this process set, even when the store would still reserve it (#105)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const service = build({ code: { fixedCode: CODE, ttlSeconds: 60 } });
    await service.start({ to: PHONE });
    const sid = (await stores.phoneIndex.get(PHONE))!;
    // Database stores whose clock runs behind this process's would still find
    // the index entry, read the record as pending and reserve.
    const stored = (await stores.verify.get(sid))!;
    vi.spyOn(stores.phoneIndex, 'get').mockResolvedValue(sid);
    vi.spyOn(stores.verify, 'get').mockResolvedValue(stored);
    const reserve = vi.spyOn(stores.verify, 'reserveAttempt').mockResolvedValue({ record: stored, outcome: 'reserved' });
    vi.setSystemTime(Date.now() + 120_000);
    expect(await outcome(service.check({ to: PHONE, code: CODE }))).toBe('CODE_EXPIRED');
    expect(reserve).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('records no lockout when a right code approved first and the last wrong code then fails to cancel (review)', async () => {
    const service = build();
    await service.start({ to: PHONE });
    await service.check({ to: PHONE, code: wrong(1) });
    await service.check({ to: PHONE, code: wrong(2) });
    const sid = (await stores.phoneIndex.get(PHONE))!;
    // A right code holding the other reservation approves just before this
    // wrong code's lockout write, which then finds the record no longer pending.
    const markStatus = stores.verify.markStatus.bind(stores.verify);
    vi.spyOn(stores.verify, 'markStatus').mockImplementation(async (id, status) => {
      if (status === 'canceled') await markStatus(id, 'approved');
      return markStatus(id, status);
    });
    const events = stores.audit.events.length;
    expect(await outcome(service.check({ to: PHONE, code: wrong(3) }))).toBe('canceled');
    expect(stores.audit.events.slice(events).filter((e) => e.type === 'verification_canceled')).toHaveLength(0);
    expect((await stores.verify.get(sid))!.status).toBe('approved');
  });

  it('answers canceled, not pending, when another check approves while a wrong code is compared (#105)', async () => {
    const service = build();
    await service.start({ to: PHONE });
    const sid = (await stores.phoneIndex.get(PHONE))!;
    // The wrong code holds a reservation with attempts left; a right code
    // holding another reservation approves before the wrong code answers.
    const reserve = stores.verify.reserveAttempt.bind(stores.verify);
    vi.spyOn(stores.verify, 'reserveAttempt').mockImplementationOnce(async (id) => {
      const r = await reserve(id);
      await stores.verify.markStatus(id, 'approved');
      return r;
    });
    const r = await service.check({ to: PHONE, code: wrong(1) });
    expect(r).toEqual({ sid, state: 'canceled', attemptsRemaining: 0 });
    expect((await stores.verify.get(sid))!.status).toBe('approved');
  });

  it('answers pending when the re-read after a counted wrong code fails (review)', async () => {
    const service = build();
    await service.start({ to: PHONE });
    const sid = (await stores.phoneIndex.get(PHONE))!;
    const get = stores.verify.get.bind(stores.verify);
    vi.spyOn(stores.verify, 'get')
      .mockImplementationOnce(get)
      .mockRejectedValueOnce(new Error('pool exhausted'));
    expect(await service.check({ to: PHONE, code: wrong(1) })).toEqual({ sid, state: 'pending', attemptsRemaining: 2 });
  });

  it('counts a check of a finished record under no_pending (#15)', async () => {
    const service = build();
    await service.start({ to: PHONE });
    const sid = (await stores.phoneIndex.get(PHONE))!;
    await stores.verify.markStatus(sid, 'approved');
    const metrics = (service as unknown as { metrics: { checksTotal: (o: string) => void } }).metrics;
    const counted = vi.spyOn(metrics, 'checksTotal');
    expect(await outcome(service.check({ to: PHONE, code: CODE }))).toBe('canceled');
    expect(counted.mock.calls).toEqual([['no_pending']]);
  });

  it('refuses a verify store without reserveAttempt on boot', () => {
    const legacy = { ...stores.verify, reserveAttempt: undefined } as unknown as VerifyStore;
    stores = { ...stores, verify: legacy as unknown as typeof stores.verify };
    expect(() => build()).toThrow('stores.verify must implement reserveAttempt');
  });
});
