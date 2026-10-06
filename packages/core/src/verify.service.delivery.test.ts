import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerifyService } from './verify.service.js';
import { createMemoryStores } from './store/create-memory-stores.js';
import { MemoryAuditSink } from './audit/memory-audit.sink.js';
import { VerifyErrorCode, VerifyException } from './errors.js';
import type { VerifyModuleOptions } from './interfaces/module-options.interface.js';
import type { ProviderSendOptions, SmsProvider, SmsSendParams } from './interfaces/sms-provider.interface.js';

const CODE = '424242';
const PHONE = '+14155552671';

/** A provider whose behaviour each test scripts; records the signal it got. */
const provider = (name: string, behave: (signal?: AbortSignal) => Promise<unknown>) => {
  const signals: (AbortSignal | undefined)[] = [];
  const p: SmsProvider = {
    name,
    send: vi.fn(async (_: SmsSendParams, opts?: ProviderSendOptions) => {
      signals.push(opts?.signal);
      await behave(opts?.signal);
      return { providerMessageId: `${name}-1`, provider: name };
    }),
  };
  return { p, signals };
};

const never = () => new Promise<never>(() => undefined);
const after = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ok = async () => undefined;

const errorCode = async (p: Promise<unknown>) => {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(VerifyException);
  return (err as VerifyException).code;
};

describe('VerifyService, delivery limits', () => {
  let stores: ReturnType<typeof createMemoryStores> & { audit: MemoryAuditSink };

  const build = (sms: VerifyModuleOptions['sms'], delivery?: VerifyModuleOptions['delivery'], extra: Partial<VerifyModuleOptions> = {}) =>
    new VerifyService({ sms, stores, code: { fixedCode: CODE }, delivery, ...extra });

  beforeEach(() => {
    stores = { ...createMemoryStores(), audit: new MemoryAuditSink() };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('moves to the fallback when the primary never answers (case 1)', async () => {
    const primary = provider('stuck', never);
    const backup = provider('backup', ok);
    const service = build({ provider: primary.p, fallbacks: [backup.p] }, { attemptTimeoutMs: 40 });
    const started = Date.now();
    const res = await service.start({ to: PHONE });
    expect(res.state).toBe('pending');
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    expect(backup.p.send).toHaveBeenCalledTimes(1);
    const dispatched = stores.audit.events.find((e) => e.type === 'code_dispatched');
    expect(dispatched?.provider).toBe('backup');
  });

  it('fails within the total limit when every provider hangs (case 1b)', async () => {
    const chain = ['a', 'b', 'c'].map((n) => provider(n, never));
    const service = build(
      { provider: chain[0].p, fallbacks: [chain[1].p, chain[2].p] },
      { attemptTimeoutMs: 60, totalTimeoutMs: 100 },
    );
    const started = Date.now();
    expect(await errorCode(service.start({ to: PHONE }))).toBe(VerifyErrorCode.SmsDispatchFailed);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(95);
    expect(elapsed).toBeLessThan(170);
    // a: 60 ms, b: the 40 ms left, c: never tried.
    expect(chain[2].p.send).not.toHaveBeenCalled();
  });

  it('answers 503 and removes the verification when the only provider hangs (case 2)', async () => {
    const only = provider('stuck', never);
    const service = build({ provider: only.p }, { attemptTimeoutMs: 30 });
    expect(await errorCode(service.start({ to: PHONE }))).toBe(VerifyErrorCode.SmsDispatchFailed);
    expect(await stores.phoneIndex.get(PHONE)).toBeNull();
  });

  it('keeps a primary that answers just inside the limit (case 3)', async () => {
    const primary = provider('slow', () => after(20));
    const backup = provider('backup', ok);
    const service = build({ provider: primary.p, fallbacks: [backup.p] }, { attemptTimeoutMs: 80 });
    await service.start({ to: PHONE });
    expect(backup.p.send).not.toHaveBeenCalled();
    expect(stores.audit.events.find((e) => e.type === 'code_dispatched')?.provider).toBe('slow');
  });

  it('leaves no unhandled rejection when an abandoned attempt fails later (case 4)', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const primary = provider('late-fail', async () => {
      await after(60);
      throw new Error('late failure');
    });
    const backup = provider('backup', ok);
    const service = build({ provider: primary.p, fallbacks: [backup.p] }, { attemptTimeoutMs: 20 });
    await service.start({ to: PHONE });
    await after(100);
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('keeps the fallback outcome when an abandoned attempt succeeds later (case 5)', async () => {
    const primary = provider('late-ok', () => after(60));
    const backup = provider('backup', ok);
    const service = build({ provider: primary.p, fallbacks: [backup.p] }, { attemptTimeoutMs: 20 });
    await service.start({ to: PHONE });
    await after(100);
    const dispatched = stores.audit.events.filter((e) => e.type === 'code_dispatched');
    expect(dispatched.map((e) => e.provider)).toEqual(['backup']);
  });

  it('aborts the signal at the limit and not on success (cases 6, 7)', async () => {
    // `stuck` ignores its signal (case 7); the core still moves on.
    const primary = provider('stuck', never);
    const backup = provider('backup', ok);
    const service = build({ provider: primary.p, fallbacks: [backup.p] }, { attemptTimeoutMs: 20 });
    await service.start({ to: PHONE });
    expect(primary.signals[0]?.aborted).toBe(true);
    expect(primary.signals[0]?.reason).toMatchObject({ name: 'DeliveryTimeoutError' });
    expect(backup.signals[0]?.aborted).toBe(false);
  });

  it('applies 5000 ms per attempt and 10000 ms in total by default (case 8)', async () => {
    // The chain budget is measured with performance.now(), which vitest only
    // fakes when asked.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const chain = ['a', 'b', 'c'].map((n) => provider(n, never));
    const service = build({ provider: chain[0].p, fallbacks: [chain[1].p, chain[2].p] });
    const outcome = service.start({ to: PHONE }).then(
      () => 'resolved',
      (e: VerifyException) => e.code,
    );
    await vi.advanceTimersByTimeAsync(4999);
    expect(chain[1].p.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(chain[1].p.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await outcome).toBe(VerifyErrorCode.SmsDispatchFailed);
    expect(chain[2].p.send).not.toHaveBeenCalled();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648, Number.MAX_SAFE_INTEGER])(
    'refuses a limit of %s (case 9)',
    (bad) => {
      const only = provider('x', ok);
      expect(() => build({ provider: only.p }, { attemptTimeoutMs: bad })).toThrow(/positive, finite/);
      expect(() => build({ provider: only.p }, { totalTimeoutMs: bad })).toThrow(/positive, finite/);
    },
  );

  it('accepts the largest limit Node can time, and still sends (case 9b)', async () => {
    // Answers after 30 ms: an overflowed timer (treated as 1 ms) would fire first.
    const only = provider('x', () => after(30));
    const service = build({ provider: only.p }, { attemptTimeoutMs: 2_147_483_647, totalTimeoutMs: 2_147_483_647 });
    expect((await service.start({ to: PHONE })).state).toBe('pending');
  });

  it('does not start a provider with only a sliver of the total left (case 1d)', async () => {
    const chain = ['a', 'b'].map((n) => provider(n, never));
    const service = build({ provider: chain[0].p, fallbacks: [chain[1].p] }, { attemptTimeoutMs: 95, totalTimeoutMs: 100 });
    expect(await errorCode(service.start({ to: PHONE }))).toBe(VerifyErrorCode.SmsDispatchFailed);
    expect(chain[1].p.send).not.toHaveBeenCalled();
  });

  it('gives an attempt only the time left in the total (case 1c)', async () => {
    const only = provider('stuck', never);
    const service = build({ provider: only.p }, { attemptTimeoutMs: 400, totalTimeoutMs: 40 });
    const started = Date.now();
    expect(await errorCode(service.start({ to: PHONE }))).toBe(VerifyErrorCode.SmsDispatchFailed);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('leaves no timer pending after a successful send (case 10)', async () => {
    vi.useFakeTimers();
    const only = provider('quick', ok);
    const service = build({ provider: only.p });
    const before = vi.getTimerCount();
    await service.start({ to: PHONE });
    expect(vi.getTimerCount()).toBe(before);
  });

  it('records a timed-out SMS attempt as a failure (case 11)', async () => {
    const nameOf = (v: object) => String((v as { metricName?: string }).metricName);
    const { Registry } = await import('prom-client');
    const registry = new Registry();
    const primary = provider('stuck', never);
    const backup = provider('backup', ok);
    const service = build(
      { provider: primary.p, fallbacks: [backup.p] },
      { attemptTimeoutMs: 20 },
      { observability: { metrics: { enabled: true, registry } } },
    );
    await service.start({ to: PHONE });
    const sends = (await registry.getMetricsAsJSON()).find((m) => m.name === 'verify_sms_send_duration_seconds');
    const counted = (sends?.values ?? []).filter((v) => nameOf(v).endsWith('_count') && v.value === 1);
    expect(counted.map((v) => v.labels)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'stuck', outcome: 'failure' }),
        expect.objectContaining({ provider: 'backup', outcome: 'success' }),
      ]),
    );
  });

  describe('cooldown after a timed-out send (#28)', () => {
    const fails = async () => {
      throw new Error('rejected');
    };
    const failure = async (p: Promise<unknown>) => {
      const err = await p.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(VerifyException);
      return err as VerifyException;
    };

    it('starts the cooldown and says when to retry when every attempt timed out (case 1)', async () => {
      const only = provider('stuck', never);
      const service = build({ provider: only.p }, { attemptTimeoutMs: 20 }, { attempts: { cooldownSeconds: 30 } });
      const err = await failure(service.start({ to: PHONE }));
      expect(err.code).toBe(VerifyErrorCode.SmsDispatchFailed);
      expect(err.extras.retryAfterMs).toBe(30_000);
      expect(await stores.cooldown.remaining(PHONE)).toBeGreaterThan(29_000);
      const retry = await failure(service.start({ to: PHONE }));
      expect(retry.code).toBe(VerifyErrorCode.CooldownActive);
      expect(only.p.send).toHaveBeenCalledTimes(1);
    });

    it('starts no cooldown when every attempt failed outright (case 2)', async () => {
      const only = provider('down', fails);
      const service = build({ provider: only.p });
      const err = await failure(service.start({ to: PHONE }));
      expect(err.code).toBe(VerifyErrorCode.SmsDispatchFailed);
      expect(err.extras.retryAfterMs).toBeUndefined();
      expect(await stores.cooldown.remaining(PHONE)).toBe(0);
      await failure(service.start({ to: PHONE }));
      expect(only.p.send).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['primary times out, fallback rejects (case 3)', never, fails],
      ['primary rejects, fallback times out (case 4)', fails, never],
    ])('starts the cooldown when %s', async (_, first, second) => {
      const a = provider('a', first);
      const b = provider('b', second);
      const service = build({ provider: a.p, fallbacks: [b.p] }, { attemptTimeoutMs: 20 });
      const err = await failure(service.start({ to: PHONE }));
      expect(err.extras.retryAfterMs).toBe(30_000);
      expect(await stores.cooldown.remaining(PHONE)).toBeGreaterThan(0);
    });

    it('still answers 503 when the cooldown cannot be written (case 5)', async () => {
      const only = provider('stuck', never);
      const service = build({ provider: only.p }, { attemptTimeoutMs: 20 });
      vi.spyOn(stores.cooldown, 'start').mockRejectedValue(new Error('store down'));
      const err = await failure(service.start({ to: PHONE }));
      expect(err.code).toBe(VerifyErrorCode.SmsDispatchFailed);
      expect(err.extras.retryAfterMs).toBeUndefined();
    });

    it('cools down when the send succeeded but its record could not be written (review P1)', async () => {
      const only = provider('ok', ok);
      const service = build({ provider: only.p });
      vi.spyOn(stores.abuse, 'recordSendAttempt').mockRejectedValueOnce(new Error('store down'));
      const err = await failure(service.start({ to: PHONE }));
      expect(err.code).toBe(VerifyErrorCode.SmsDispatchFailed);
      expect(err.extras.retryAfterMs).toBe(30_000);
      expect((await failure(service.start({ to: PHONE }))).code).toBe(VerifyErrorCode.CooldownActive);
      expect(only.p.send).toHaveBeenCalledTimes(1);
    });

    it('cools down when the send succeeded but the cooldown write failed once (review P2)', async () => {
      const only = provider('ok', ok);
      const service = build({ provider: only.p });
      vi.spyOn(stores.cooldown, 'start').mockRejectedValueOnce(new Error('store down'));
      const err = await failure(service.start({ to: PHONE }));
      expect(err.extras.retryAfterMs).toBe(30_000);
      expect((await failure(service.start({ to: PHONE }))).code).toBe(VerifyErrorCode.CooldownActive);
      expect(only.p.send).toHaveBeenCalledTimes(1);
    });

    it('starts the cooldown before cleanup that can fail (Codex review)', async () => {
      const only = provider('stuck', never);
      const service = build({ provider: only.p }, { attemptTimeoutMs: 20 });
      vi.spyOn(stores.verify, 'delete').mockRejectedValueOnce(new Error('store down'));
      await service.start({ to: PHONE }).catch(() => undefined);
      expect(await stores.cooldown.remaining(PHONE)).toBeGreaterThan(0);
    });

    it('answers 503, not a raw error, when the cooldown store throws synchronously (review P3)', async () => {
      const only = provider('stuck', never);
      const service = build({ provider: only.p }, { attemptTimeoutMs: 20 });
      vi.spyOn(stores.cooldown, 'start').mockImplementation(() => {
        throw new Error('sync boom');
      });
      const err = await failure(service.start({ to: PHONE }));
      expect(err.code).toBe(VerifyErrorCode.SmsDispatchFailed);
      expect(err.extras.retryAfterMs).toBeUndefined();
    });

    it('does not count a provider skipped for lack of budget as a timeout (review P5)', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
      const slowFail = provider('slow-fail', async () => {
        await after(95);
        throw new Error('rejected');
      });
      const backup = provider('backup', ok);
      const service = build({ provider: slowFail.p, fallbacks: [backup.p] }, { attemptTimeoutMs: 200, totalTimeoutMs: 100 });
      const pending = failure(service.start({ to: PHONE }));
      await vi.advanceTimersByTimeAsync(100);
      const err = await pending;
      expect(backup.p.send).not.toHaveBeenCalled();
      expect(err.extras.retryAfterMs).toBeUndefined();
      expect(await stores.cooldown.remaining(PHONE)).toBe(0);
    });

    it('answers 503 and still clears the index when a cleanup step fails (round 2, finding 1)', async () => {
      const only = provider('stuck', never);
      const service = build({ provider: only.p }, { attemptTimeoutMs: 20 });
      vi.spyOn(stores.verify, 'delete').mockRejectedValueOnce(new Error('store down'));
      const err = await failure(service.start({ to: PHONE }));
      expect(err.code).toBe(VerifyErrorCode.SmsDispatchFailed);
      expect(err.extras.retryAfterMs).toBe(30_000);
      expect(await stores.phoneIndex.get(PHONE)).toBeNull();
    });

    it('answers 503 with retryAfterMs when the failure record cannot be written (round 2, finding 2)', async () => {
      const only = provider('stuck', never);
      const service = build({ provider: only.p }, { attemptTimeoutMs: 20 });
      vi.spyOn(stores.abuse, 'recordSendAttempt').mockRejectedValueOnce(new Error('abuse down'));
      const err = await failure(service.start({ to: PHONE }));
      expect(err.code).toBe(VerifyErrorCode.SmsDispatchFailed);
      expect(err.extras.retryAfterMs).toBe(30_000);
    });

    it('treats an error after a successful attempt as may-have-sent (round 2, finding 4)', async () => {
      const only = provider('ok', ok);
      const service = build({ provider: only.p });
      const metrics = (service as unknown as { metrics: { smsSendDuration: () => void } }).metrics;
      vi.spyOn(metrics, 'smsSendDuration').mockImplementation(() => {
        throw new Error('metrics broke');
      });
      const err = await failure(service.start({ to: PHONE }));
      expect(err.code).toBe(VerifyErrorCode.SmsDispatchFailed);
      expect(err.extras.retryAfterMs).toBe(30_000);
    });

    it('omits retryAfterMs when the cooldown is zero (round 2, finding 8)', async () => {
      const only = provider('stuck', never);
      const service = build({ provider: only.p }, { attemptTimeoutMs: 20 }, { attempts: { cooldownSeconds: 0 } });
      const err = await failure(service.start({ to: PHONE }));
      expect(err.extras.retryAfterMs).toBeUndefined();
    });

    it('scrubs the recipient from a provider that throws synchronously (review P4)', async () => {
      const throwing: SmsProvider = {
        name: 'sync',
        send: () => {
          throw new Error(`bad ${PHONE}`);
        },
      };
      const recorded = vi.spyOn(stores.abuse, 'recordSendAttempt');
      const service = build({ provider: throwing });
      await failure(service.start({ to: PHONE }));
      const errorCodes = recorded.mock.calls.map((c) => String(c[0].errorCode));
      expect(errorCodes.join(' ')).not.toContain(PHONE);
      expect(errorCodes.join(' ')).toContain('[recipient]');
    });

    it('still removes the verification and records the failure (cases 6, 7)', async () => {
      const only = provider('stuck', never);
      const service = build({ provider: only.p }, { attemptTimeoutMs: 20 });
      const recorded = vi.spyOn(stores.abuse, 'recordSendAttempt');
      const removed = vi.spyOn(stores.verify, 'delete');
      await failure(service.start({ to: PHONE }));
      expect(removed).toHaveBeenCalledTimes(1);
      expect(await stores.phoneIndex.get(PHONE)).toBeNull();
      expect(recorded).toHaveBeenCalledWith(expect.objectContaining({ success: false, provider: 'stuck' }));
    });
  });

  it('keeps the provider request id in the logged error (case 14)', async () => {
    const failing: SmsProvider = {
      name: 'aws-like',
      send: vi.fn(async () => {
        throw Object.assign(new Error(`rejected ${PHONE}`), { $metadata: { requestId: 'req-123' } });
      }),
    };
    const backup = provider('backup', ok);
    const service = build({ provider: failing, fallbacks: [backup.p] });
    const warn = vi.spyOn((service as unknown as { log: { warn: (m: string) => void } }).log, 'warn');
    await service.start({ to: PHONE });
    const line = warn.mock.calls.map((c) => String(c[0])).find((m) => m.includes('aws-like failed'));
    expect(line).toContain('(request id req-123)');
    expect(line).not.toContain(PHONE);
  });
});
