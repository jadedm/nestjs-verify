import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VerifyService } from './verify.service.js';
import { createMemoryStores } from './store/create-memory-stores.js';
import { MemoryAuditSink } from './audit/memory-audit.sink.js';
import { VerifyErrorCode, VerifyException } from './errors.js';
import type { VerifyModuleOptions } from './interfaces/module-options.interface.js';
import type { EmailProvider, EmailSendParams } from './interfaces/email-provider.interface.js';
import type { SmsProvider, SmsSendParams } from './interfaces/sms-provider.interface.js';

const CODE = '424242';

const emailProvider = (name: string, fail = false) => {
  const sent: EmailSendParams[] = [];
  const provider: EmailProvider = {
    name,
    send: vi.fn(async (p: EmailSendParams) => {
      if (fail) throw new Error(`${name} down`);
      sent.push(p);
      return { providerMessageId: `${name}-1`, provider: name };
    }),
  };
  return { provider, sent };
};

const smsProvider = (name = 'sms-stub') => {
  const sent: SmsSendParams[] = [];
  const provider: SmsProvider = {
    name,
    send: vi.fn(async (p: SmsSendParams) => {
      sent.push(p);
      return { providerMessageId: `${name}-1`, provider: name };
    }),
  };
  return { provider, sent };
};

const errorCode = async (p: Promise<unknown>) => {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(VerifyException);
  return (err as VerifyException).code;
};

describe('VerifyService, email channel', () => {
  let stores: ReturnType<typeof createMemoryStores> & { audit: MemoryAuditSink };
  let email: ReturnType<typeof emailProvider>;
  let sms: ReturnType<typeof smsProvider>;
  let service: VerifyService;

  const build = (overrides: Partial<VerifyModuleOptions> = {}) =>
    new VerifyService({
      sms: { provider: sms.provider },
      email: { provider: email.provider, subject: 'Sign in to Sidecar' },
      stores,
      code: { fixedCode: CODE },
      ...overrides,
    });

  beforeEach(() => {
    stores = { ...createMemoryStores(), audit: new MemoryAuditSink() };
    email = emailProvider('email-stub');
    sms = smsProvider();
    service = build();
  });

  it('sends the code by email and not by SMS (case 1)', async () => {
    const result = await service.start({ to: 'Admin@Example.com', channel: 'email' });
    expect(result.channel).toBe('email');
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({ to: 'Admin@Example.com', subject: 'Sign in to Sidecar' });
    expect(email.sent[0].text).toContain(CODE);
    expect(sms.sent).toHaveLength(0);
  });

  it('approves the right code whatever the case of the address (case 2)', async () => {
    await service.start({ to: 'Admin@Example.com', channel: 'email' });
    expect((await service.check({ to: 'admin@EXAMPLE.com', code: CODE })).state).toBe('approved');
  });

  it('gives case variants of one mailbox one cooldown (isolated review)', async () => {
    await service.start({ to: 'Victim@example.com', channel: 'email' });
    expect(await errorCode(service.start({ to: 'victim@example.com', channel: 'email' }))).toBe(
      VerifyErrorCode.CooldownActive,
    );
    expect(await errorCode(service.start({ to: 'VICTIM@EXAMPLE.COM', channel: 'email' }))).toBe(
      VerifyErrorCode.CooldownActive,
    );
    expect(email.sent).toHaveLength(1);
  });

  it.each(['a<victim@example.com>', 'a,b@example.com', '"a"@example.com', 'a@example.com;b@example.com'])(
    'rejects an address with display-name or list characters: %s (isolated review)',
    async (to) => {
      expect(await errorCode(service.start({ to, channel: 'email' }))).toBe(VerifyErrorCode.InvalidEmail);
    },
  );

  it('keeps the address out of provider errors in logs and the abuse store (isolated review)', async () => {
    const leaky: EmailProvider = {
      name: 'leaky',
      send: async () => {
        throw new Error('The following identities failed the check: Secret.Person@Example.com');
      },
    };
    service = build({ email: { provider: leaky } });
    const warn = vi.spyOn((service as unknown as { log: { warn: (m: string) => void } }).log, 'warn');
    const recordSpy = vi.spyOn(stores.abuse, 'recordSendAttempt');
    await errorCode(service.start({ to: 'Secret.Person@Example.com', channel: 'email' }));
    // The abuse record's `phone` field is the store key by design; the error text is what leaks.
    const errorTexts = JSON.stringify([warn.mock.calls, recordSpy.mock.calls.map(([r]) => r.errorCode)]);
    expect(errorTexts).toContain('[recipient]');
    expect(errorTexts.toLowerCase()).not.toContain('secret.person');
  });

  it('removes the verification when the cooldown cannot be written after a send (isolated review)', async () => {
    vi.spyOn(stores.cooldown, 'start').mockRejectedValueOnce(new Error('store down'));
    expect(await errorCode(service.start({ to: 'a@example.com', channel: 'email' }))).toBe(
      VerifyErrorCode.SmsDispatchFailed,
    );
    expect(await stores.phoneIndex.get('a@example.com')).toBeFalsy();
  });

  it('keeps email sends out of the SMS send-duration metric (Codex review)', async () => {
    // prom-client sets metricName on histogram values but leaves it off the public type.
    const nameOf = (v: object) => String((v as { metricName?: string }).metricName);
    const { Registry } = await import('prom-client');
    const registry = new Registry();
    service = build({ observability: { metrics: { enabled: true, registry } } });
    await service.start({ to: 'a@example.com', channel: 'email' });
    const sends = (await registry.getMetricsAsJSON()).find((m) => m.name === 'verify_sms_send_duration_seconds');
    const count = (sends?.values ?? []).filter((v) => nameOf(v).endsWith('_count'));
    expect(count.every((v) => v.value === 0)).toBe(true);
    await service.start({ to: '+14155552671' });
    const after = (await registry.getMetricsAsJSON()).find((m) => m.name === 'verify_sms_send_duration_seconds');
    expect((after?.values ?? []).some((v) => nameOf(v).endsWith('_count') && v.value === 1)).toBe(true);
  });

  it('locks out after the maximum wrong codes (case 3)', async () => {
    service = build({ attempts: { max: 2 } });
    await service.start({ to: 'a@example.com', channel: 'email' });
    expect(await service.check({ to: 'a@example.com', code: '000000' })).toMatchObject({
      state: 'pending',
      attemptsRemaining: 1,
    });
    expect((await service.check({ to: 'a@example.com', code: '000000' })).state).toBe('canceled');
  });

  it.each([
    ['email with no email provider', { email: undefined }, 'email', 'a@example.com'],
    ['whatsapp', {}, 'whatsapp', '+14155552671'],
    ['voice', {}, 'voice', '+14155552671'],
  ] as const)('refuses %s before touching any state (cases 4, 5)', async (_l, overrides, channel, to) => {
    service = build(overrides);
    const spies = [
      vi.spyOn(stores.rateLimit, 'hit'),
      vi.spyOn(stores.abuse, 'recordSendAttempt'),
      vi.spyOn(stores.abuse, 'countDistinctPhonesByIp'),
      vi.spyOn(stores.verify, 'create'),
      vi.spyOn(stores.phoneIndex, 'set'),
      vi.spyOn(stores.cooldown, 'start'),
    ];
    expect(await errorCode(service.start({ to, channel, ip: '10.0.0.1' }))).toBe(
      VerifyErrorCode.ChannelNotSupported,
    );
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(sms.sent).toHaveLength(0);
    expect(email.sent).toHaveLength(0);
  });

  it('sends by SMS when no channel is given (case 17)', async () => {
    const result = await service.start({ to: '+14155552671' });
    expect(result.channel).toBe('sms');
    expect(sms.sent).toEqual([{ to: '+14155552671', body: expect.stringContaining(CODE) }]);
    expect((await service.check({ to: '+14155552671', code: CODE })).state).toBe('approved');
  });

  it.each([
    ['malformed', 'not-an-email'],
    ['255 characters', `${'a'.repeat(243)}@example.com`],
    ['a phone on the email channel', '+14155552671'],
  ])('rejects an email recipient that is %s (cases 7, 8)', async (_l, to) => {
    expect(await errorCode(service.start({ to, channel: 'email' }))).toBe(VerifyErrorCode.InvalidEmail);
  });

  it('rejects an email on the sms channel (case 8)', async () => {
    expect(await errorCode(service.start({ to: 'a@example.com', channel: 'sms' }))).toBe(
      VerifyErrorCode.InvalidPhone,
    );
  });

  it('accepts an email of exactly 254 characters (case 19)', async () => {
    const to = `${'a'.repeat(242)}@example.com`;
    expect(to).toHaveLength(254);
    expect((await service.start({ to, channel: 'email' })).channel).toBe('email');
  });

  it('applies cooldown and the per-recipient rate limit to an email address (case 9)', async () => {
    await service.start({ to: 'a@example.com', channel: 'email' });
    expect(await errorCode(service.start({ to: 'a@example.com', channel: 'email' }))).toBe(
      VerifyErrorCode.CooldownActive,
    );
    stores.cooldown = createMemoryStores().cooldown;
    stores.rateLimit = createMemoryStores().rateLimit;
    service = build({ attempts: { cooldownSeconds: 0 }, rateLimit: { perPhone: { count: 1, windowSeconds: 60 } } });
    await service.start({ to: 'b@example.com', channel: 'email' });
    expect(await errorCode(service.start({ to: 'b@example.com', channel: 'email' }))).toBe(
      VerifyErrorCode.PhoneRateLimited,
    );
  });

  it('applies the IP velocity check to email addresses (case 9)', async () => {
    service = build({ abuse: { maxDistinctPhonesPerIp: 2, velocityWindowSeconds: 60 } });
    await service.start({ to: 'a@example.com', channel: 'email', ip: '10.0.0.9' });
    await service.start({ to: 'b@example.com', channel: 'email', ip: '10.0.0.9' });
    expect(await errorCode(service.start({ to: 'c@example.com', channel: 'email', ip: '10.0.0.9' }))).toBe(
      VerifyErrorCode.AbuseVelocity,
    );
  });

  it('records the fallback that sent, not the primary that failed (cases 10, 18)', async () => {
    const broken = emailProvider('primary', true);
    const backup = emailProvider('backup');
    service = build({ email: { provider: broken.provider, fallbacks: [backup.provider] } });
    const recordSpy = vi.spyOn(stores.abuse, 'recordSendAttempt');
    await service.start({ to: 'a@example.com', channel: 'email' });
    expect(backup.sent).toHaveLength(1);
    expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({ provider: 'backup', success: true }));
    const dispatched = stores.audit.events.find((e) => e.type === 'code_dispatched');
    expect(dispatched).toMatchObject({ provider: 'backup', channel: 'email' });
  });

  it('removes the pending verification when every email provider fails (case 10)', async () => {
    service = build({ email: { provider: emailProvider('only', true).provider } });
    expect(await errorCode(service.start({ to: 'a@example.com', channel: 'email' }))).toBe(
      VerifyErrorCode.SmsDispatchFailed,
    );
    expect(await stores.phoneIndex.get('a@example.com')).toBeFalsy();
    expect(await stores.cooldown.remaining('a@example.com')).toBe(0);
  });

  it('fails to construct with neither sms nor email, and works with email only (case 11)', async () => {
    expect(() => build({ sms: undefined, email: undefined })).toThrow(/at least one of `sms` or `email`/);
    service = build({ sms: undefined });
    expect(await errorCode(service.start({ to: '+14155552671' }))).toBe(VerifyErrorCode.ChannelNotSupported);
    expect((await service.start({ to: 'a@example.com', channel: 'email' })).channel).toBe('email');
  });

  it('reports approved only to the check that approved, never to a later check with any code', async () => {
    await service.start({ to: 'a@example.com', channel: 'email' });
    // Keep the index pointing at the approved record, as a failed delete would.
    vi.spyOn(stores.phoneIndex, 'deleteIfMatches').mockResolvedValue(undefined);
    expect((await service.check({ to: 'a@example.com', code: CODE })).state).toBe('approved');
    expect((await service.check({ to: 'a@example.com', code: '000000' })).state).toBe('canceled');
    expect((await service.check({ to: 'a@example.com', code: CODE })).state).toBe('canceled');
  });

  it('still reports approved when the index cleanup fails, and nothing after it does', async () => {
    await service.start({ to: 'a@example.com', channel: 'email' });
    vi.spyOn(stores.phoneIndex, 'deleteIfMatches').mockRejectedValue(new Error('store down'));
    expect((await service.check({ to: 'a@example.com', code: CODE })).state).toBe('approved');
    expect((await service.check({ to: 'a@example.com', code: '000000' })).state).toBe('canceled');
  });

  it('gives approved to exactly one of two simultaneous right-code checks', async () => {
    await service.start({ to: '+14155552671' });
    const both = await Promise.all([
      service.check({ to: '+14155552671', code: CODE }),
      service.check({ to: '+14155552671', code: CODE }).catch(() => ({ state: 'no-pending' })),
    ]);
    expect(both.filter((r) => r.state === 'approved')).toHaveLength(1);
  });

  it('never puts the full address in audit events (case 12)', async () => {
    await service.start({ to: 'secret.person@example.com', channel: 'email', ip: '10.0.0.1' });
    await service.check({ to: 'secret.person@example.com', code: CODE, ip: '10.0.0.1' });
    expect(stores.audit.events.length).toBeGreaterThan(0);
    const dump = JSON.stringify(stores.audit.events);
    expect(dump).not.toContain('secret.person');
    expect(dump).toContain('s***@example.com');
  });
});
