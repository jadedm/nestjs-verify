import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from './index.js';
import { VerifyService } from './verify.service.js';
import { createMemoryStores } from './store/create-memory-stores.js';
import { MemoryAuditSink } from './audit/memory-audit.sink.js';
import { MockEmailProvider } from './providers/mock-email.provider.js';
import { MockSmsProvider } from './providers/mock-sms.provider.js';
import { RecipientRateLimitedException, VerifyException } from './errors.js';
import type { VerifyModuleOptions } from './interfaces/module-options.interface.js';
import type { AbuseStore } from './interfaces/abuse-store.interface.js';

const CODE = '424242';
const PHONE = '+14155552671';
const OTHER = '+14155552672';
const IP = '203.0.113.7';

const failure = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e as VerifyException,
  );

describe('VerifyService, the names removed in 1.0 (#124)', () => {
  let stores: ReturnType<typeof createMemoryStores> & { audit: MemoryAuditSink };

  const build = (extra: Record<string, unknown> = {}) =>
    new VerifyService({
      sms: { provider: new MockSmsProvider({ logToConsole: false }) },
      email: { provider: new MockEmailProvider({ logToConsole: false }) },
      stores,
      code: { fixedCode: CODE },
      attempts: { max: 3, cooldownSeconds: 0 },
      ...extra,
    } as unknown as VerifyModuleOptions);

  beforeEach(() => {
    stores = { ...createMemoryStores(), audit: new MemoryAuditSink() };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. applies the limits under the 1.0 names', async () => {
    const service = build({
      rateLimit: { perRecipient: { count: 1, windowSeconds: 60 } },
      abuse: { maxDistinctRecipientsPerIp: 1 },
    });
    await service.start({ to: PHONE, ip: IP });
    expect((await failure(service.start({ to: PHONE, ip: '198.51.100.1' })))?.code).toBe('RECIPIENT_RATE_LIMITED');
    expect((await failure(service.start({ to: OTHER, ip: IP })))?.code).toBe('ABUSE_VELOCITY');
  });

  it.each([
    ['stores.phoneIndex', () => ({ stores: { ...stores, phoneIndex: stores.recipientIndex } }), 'stores.recipientIndex'],
    ['rateLimit.perPhone', () => ({ rateLimit: { perPhone: { count: 1, windowSeconds: 60 } } }), 'rateLimit.perRecipient'],
    ['abuse.maxDistinctPhonesPerIp', () => ({ abuse: { maxDistinctPhonesPerIp: 1 } }), 'abuse.maxDistinctRecipientsPerIp'],
  ])('2. refuses %s at boot, naming the 1.0 name', (name, extra, replacement) => {
    expect(() => build(extra())).toThrow(`Option names removed in 1.0: ${name} (use ${replacement})`);
  });

  it('2b. refuses a removed name set to null, and ignores a hidden one a 0.9 factory result carries', () => {
    expect(() => build({ rateLimit: { perPhone: null } })).toThrow('rateLimit.perPhone (use rateLimit.perRecipient)');
    const fromFactory = Object.defineProperty({ ...stores }, 'phoneIndex', { get: () => stores.recipientIndex, enumerable: false });
    expect(() => build({ stores: fromFactory })).not.toThrow();
  });

  it('3. refuses an abuse store without countDistinctRecipientsByIp', () => {
    const abuse = { recordSendAttempt: async () => undefined, countAttemptsByIp: async () => 0, countDistinctPhonesByIp: async () => 0 };
    expect(() => build({ stores: { ...stores, abuse: abuse as unknown as AbuseStore } })).toThrow(
      'stores.abuse must implement countDistinctRecipientsByIp',
    );
  });

  it('4. requires stores.recipientIndex', () => {
    const { recipientIndex: _gone, ...rest } = stores;
    expect(() => build({ stores: rest })).toThrow('stores.recipientIndex is required');
  });

  it('5. exports none of the removed names', () => {
    const exported = core as Record<string, unknown>;
    for (const name of ['PhoneRateLimitedException', 'MemoryPhoneIndexStore']) expect(exported).not.toHaveProperty(name);
    expect(core.VerifyErrorCode).not.toHaveProperty('PhoneRateLimited');
    expect(core.BLOCK_REASON).not.toHaveProperty('PhoneRateLimit');
    expect(core.TELEMETRY).not.toHaveProperty('ATTR_PHONE_REDACTED');
    expect(core.METRICS).not.toHaveProperty('HIST_SMS_SEND_DURATION');
    expect(core.METRICS).not.toHaveProperty('COUNTER_PHONE_RATE_LIMIT_HITS');
    expect(createMemoryStores()).not.toHaveProperty('phoneIndex');
    expect(new core.MemoryAbuseStore()).not.toHaveProperty('countDistinctPhonesByIp');
    expect(new core.MemoryVerifyStore()).not.toHaveProperty('incrementAttempts');
  });

  it('6. writes records, send attempts and audit events under the recipient names alone', async () => {
    const create = vi.spyOn(stores.verify, 'create');
    const record = vi.spyOn(stores.abuse, 'recordSendAttempt');
    await build().start({ to: PHONE, ip: IP });
    expect(create.mock.calls[0][0]).toMatchObject({ recipient: PHONE });
    expect(create.mock.calls[0][0]).not.toHaveProperty('phone');
    expect(record.mock.calls[0][0]).toMatchObject({ recipient: PHONE });
    expect(record.mock.calls[0][0]).not.toHaveProperty('phone');
    for (const event of stores.audit.events) expect(event).not.toHaveProperty('phoneRedacted');
  });

  it('7. an email recipient is what every field holds', async () => {
    await build().start({ to: 'Someone@Example.COM', channel: 'email', ip: IP });
    const sid = (await stores.recipientIndex.get('someone@example.com'))!;
    expect((await stores.verify.get(sid))!.recipient).toBe('someone@example.com');
    expect(await stores.abuse.countAttemptsByRecipient('someone@example.com', 60_000)).toBe(1);
    expect(await stores.abuse.countDistinctRecipientsByIp(IP, 60_000)).toBe(1);
  });

  it('8. a recipient over its limit answers RECIPIENT_RATE_LIMITED with 429', async () => {
    const service = build({ rateLimit: { perRecipient: { count: 1, windowSeconds: 60 } } });
    await service.start({ to: PHONE });
    const err = await failure(service.start({ to: PHONE }));
    expect(err).toBeInstanceOf(RecipientRateLimitedException);
    expect(err?.code).toBe('RECIPIENT_RATE_LIMITED');
    expect(err?.getStatus()).toBe(429);
  });
});
