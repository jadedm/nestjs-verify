import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerifyService } from './verify.service.js';
import { createMemoryStores } from './store/create-memory-stores.js';
import { MemoryAuditSink } from './audit/memory-audit.sink.js';
import { MemoryVerifyStore } from './store/memory-verify.store.js';
import { MemoryPhoneIndexStore, MemoryRecipientIndexStore } from './store/memory-recipient-index.store.js';
import { MockEmailProvider } from './providers/mock-email.provider.js';
import { MockSmsProvider } from './providers/mock-sms.provider.js';
import {
  PhoneRateLimitedException,
  RecipientRateLimitedException,
  VerifyErrorCode,
  VerifyException,
} from './errors.js';
import type { VerifyModuleOptions } from './interfaces/module-options.interface.js';
import type { AbuseStore, SendAttempt } from './interfaces/abuse-store.interface.js';
import type { VerificationRecord } from './interfaces/verify-store.interface.js';

const CODE = '424242';
const PHONE = '+14155552671';
const OTHER = '+14155552672';
const IP = '203.0.113.7';

const failure = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e as VerifyException,
  );

// A verify store written for 0.8: it keeps and returns `phone` only.
class LegacyVerifyStore extends MemoryVerifyStore {
  readonly created: VerificationRecord[] = [];
  async create(v: VerificationRecord): Promise<void> {
    this.created.push(v);
    const { recipient: _dropped, ...legacy } = v;
    await super.create(legacy as VerificationRecord);
  }
}

// An abuse store written for 0.8: it reads `phone` and has only the old method names.
class LegacyAbuseStore implements AbuseStore {
  readonly log: Array<{ phone?: string; ip?: string }> = [];
  async recordSendAttempt(s: SendAttempt): Promise<void> {
    this.log.push({ phone: s.phone, ip: s.ip });
  }
  async countAttemptsByIp(ip: string): Promise<number> {
    return this.log.filter((a) => a.ip === ip).length;
  }
  async countDistinctPhonesByIp(ip: string): Promise<number> {
    return new Set(this.log.filter((a) => a.ip === ip).map((a) => a.phone)).size;
  }
}

describe('VerifyService, recipient names and their pre-0.9.0 aliases (#8)', () => {
  let stores: ReturnType<typeof createMemoryStores> & { audit: MemoryAuditSink };
  let warn: ReturnType<typeof vi.spyOn>;

  const build = (extra: Partial<VerifyModuleOptions> = {}) =>
    new VerifyService({
      sms: { provider: new MockSmsProvider({ logToConsole: false }) },
      email: { provider: new MockEmailProvider({ logToConsole: false }) },
      stores,
      code: { fixedCode: CODE },
      attempts: { max: 3, cooldownSeconds: 0 },
      ...extra,
    } as VerifyModuleOptions);

  // Stores as a 0.9.0 user writes them: the index under its new name only.
  // (A spread of the factory output already leaves `phoneIndex` out.)
  const newStores = () => ({ ...stores });
  // Stores as a 0.8 user wrote them: the index under its old name only.
  const oldStores = () => {
    const { recipientIndex, ...rest } = stores;
    return { ...rest, phoneIndex: recipientIndex };
  };

  beforeEach(() => {
    stores = { ...createMemoryStores(), audit: new MemoryAuditSink() };
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const warnings = (): string[] => warn.mock.calls.map((c: unknown[]) => String(c[0]));

  it('1. applies the limits under their new names, with no warning', async () => {
    const service = build({
      stores: newStores() as VerifyModuleOptions['stores'],
      rateLimit: { perRecipient: { count: 1, windowSeconds: 60 } },
      abuse: { maxDistinctRecipientsPerIp: 1 },
    });
    await service.start({ to: PHONE, ip: IP });
    expect((await failure(service.start({ to: PHONE, ip: '198.51.100.1' })))?.code).toBe('RECIPIENT_RATE_LIMITED');
    expect((await failure(service.start({ to: OTHER, ip: IP })))?.code).toBe('ABUSE_VELOCITY');
    expect(warnings().filter((w) => w.includes('deprecated'))).toEqual([]);
  });

  it('2. applies the limits under their old names, warning once per name', async () => {
    const service = build({
      stores: oldStores() as VerifyModuleOptions['stores'],
      rateLimit: { perPhone: { count: 1, windowSeconds: 60 } },
      abuse: { maxDistinctPhonesPerIp: 1 },
    });
    await service.start({ to: PHONE, ip: IP });
    expect((await failure(service.start({ to: PHONE, ip: '198.51.100.1' })))?.code).toBe('RECIPIENT_RATE_LIMITED');
    expect((await failure(service.start({ to: OTHER, ip: IP })))?.code).toBe('ABUSE_VELOCITY');
    const deprecated = warnings().filter((w) => w.includes('deprecated'));
    expect(deprecated).toHaveLength(3);
    for (const name of ['stores.phoneIndex', 'rateLimit.perPhone', 'abuse.maxDistinctPhonesPerIp']) {
      expect(deprecated.filter((w) => w.startsWith(`${name} is deprecated`))).toHaveLength(1);
    }
  });

  it('3. refuses an old and a new option name given different values', () => {
    expect(() =>
      build({ rateLimit: { perRecipient: { count: 1, windowSeconds: 60 }, perPhone: { count: 2, windowSeconds: 60 } } }),
    ).toThrow('Set rateLimit.perRecipient or rateLimit.perPhone, not both');
    expect(() => build({ abuse: { maxDistinctRecipientsPerIp: 1, maxDistinctPhonesPerIp: 2 } })).toThrow(
      'Set abuse.maxDistinctRecipientsPerIp or abuse.maxDistinctPhonesPerIp, not both',
    );
  });

  it('3a. accepts equal option values given under both names', () => {
    const policy = () => ({ count: 1, windowSeconds: 60 });
    expect(() => build({ rateLimit: { perRecipient: policy(), perPhone: policy() } })).not.toThrow();
  });

  it('3b. takes the factory output as is: phoneIndex is the same object, not enumerable, no warning', () => {
    const factory = createMemoryStores();
    expect(factory.phoneIndex).toBe(factory.recipientIndex);
    expect(Object.keys(factory)).not.toContain('phoneIndex');
    expect(() => build({ stores: createMemoryStores() })).not.toThrow();
    expect(warnings().filter((w) => w.includes('deprecated'))).toEqual([]);
  });

  it('3f. changing the factory object in place, under either name, uses the new store and never refuses it', async () => {
    const byNew = createMemoryStores();
    const a = new MemoryRecipientIndexStore();
    byNew.recipientIndex = a;
    expect(byNew.phoneIndex).toBe(a);
    const byOld = createMemoryStores();
    const b = new MemoryRecipientIndexStore();
    byOld.phoneIndex = b;
    expect(byOld.recipientIndex).toBe(b);
    const byAssign = Object.assign(createMemoryStores(), { phoneIndex: new MemoryRecipientIndexStore() });
    expect(byAssign.recipientIndex).toBe(byAssign.phoneIndex);
    for (const [s, store] of [[byNew, a], [byOld, b]] as const) {
      const service = build({ stores: s });
      await service.start({ to: PHONE });
      expect(await store.get(PHONE)).toMatch(/^vr_/);
    }
    expect(warnings().filter((w) => w.includes('different stores'))).toEqual([]);
  });

  it('3d. a factory spread with recipientIndex replaced uses the replacement, with no warning', async () => {
    const other = new MemoryRecipientIndexStore();
    const service = build({ stores: { ...createMemoryStores(), recipientIndex: other } });
    await service.start({ to: PHONE });
    expect(await other.get(PHONE)).toMatch(/^vr_/);
    expect(warnings().filter((w) => w.includes('deprecated'))).toEqual([]);
  });

  it('3e. a factory spread with phoneIndex replaced, as written for 0.8, uses the replacement and warns', async () => {
    const factory = createMemoryStores();
    const other = new MemoryRecipientIndexStore();
    const service = build({ stores: { ...factory, phoneIndex: other } });
    await service.start({ to: PHONE });
    expect(await other.get(PHONE)).toMatch(/^vr_/);
    expect(await factory.recipientIndex.get(PHONE)).toBeNull();
    expect(warnings().some((w) => w.startsWith('stores.phoneIndex and stores.recipientIndex name different stores'))).toBe(true);
  });

  it('3c. refuses stores with no index under either name', () => {
    const { recipientIndex: _a, phoneIndex: _b, ...none } = stores;
    expect(() => build({ stores: none as unknown as VerifyModuleOptions['stores'] })).toThrow('stores.recipientIndex is required');
  });

  it('12. runs start, check, rate limit and IP velocity on stores written for 0.8', async () => {
    const verify = new LegacyVerifyStore();
    const abuse = new LegacyAbuseStore();
    const service = build({
      stores: { ...oldStores(), verify, abuse } as VerifyModuleOptions['stores'],
      rateLimit: { perPhone: { count: 1, windowSeconds: 60 } },
      abuse: { maxDistinctPhonesPerIp: 1 },
    });
    await service.start({ to: PHONE, ip: IP });
    expect(verify.created[0]).toMatchObject({ recipient: PHONE, phone: PHONE });
    expect(abuse.log[0]).toEqual({ phone: PHONE, ip: IP });
    expect((await service.check({ to: PHONE, code: CODE })).state).toBe('approved');
    expect((await failure(service.start({ to: PHONE, ip: '198.51.100.1' })))?.code).toBe('RECIPIENT_RATE_LIMITED');
    expect((await failure(service.start({ to: OTHER, ip: IP })))?.code).toBe('ABUSE_VELOCITY');
    expect(warnings().some((w) => w.startsWith('stores.abuse.countDistinctPhonesByIp is deprecated'))).toBe(true);
  });

  it('12b. refuses an abuse store with neither distinct-recipient method', () => {
    const abuse = { recordSendAttempt: async () => undefined, countAttemptsByIp: async () => 0 } as AbuseStore;
    expect(() => build({ stores: { ...stores, abuse } })).toThrow('stores.abuse must implement countDistinctRecipientsByIp');
  });

  it('6. audit events carry recipientRedacted, and phoneRedacted with the same value', async () => {
    const service = build();
    await service.start({ to: PHONE });
    const started = stores.audit.events.find((e) => e.type === 'verification_started')!;
    expect(started.recipientRedacted).toMatch(/\*\*\*/);
    expect(started.phoneRedacted).toBe(started.recipientRedacted);
  });

  it('7. old names are the same classes and constants', () => {
    expect(MemoryPhoneIndexStore).toBe(MemoryRecipientIndexStore);
    expect(PhoneRateLimitedException).toBe(RecipientRateLimitedException);
    expect(VerifyErrorCode.PhoneRateLimited).toBe('RECIPIENT_RATE_LIMITED');
  });

  it('9. an email recipient is what every new field holds', async () => {
    const service = build();
    await service.start({ to: 'Someone@Example.COM', channel: 'email', ip: IP });
    const sid = (await stores.recipientIndex.get('someone@example.com'))!;
    expect((await stores.verify.get(sid))!).toMatchObject({ recipient: 'someone@example.com', phone: 'someone@example.com' });
    expect(await stores.abuse.countAttemptsByRecipient('someone@example.com', 60_000)).toBe(1);
    expect(await stores.abuse.countDistinctRecipientsByIp(IP, 60_000)).toBe(1);
  });

  it('15. a recipient over its limit answers RECIPIENT_RATE_LIMITED with 429', async () => {
    const service = build({ rateLimit: { perRecipient: { count: 1, windowSeconds: 60 } } });
    await service.start({ to: PHONE });
    const err = await failure(service.start({ to: PHONE }));
    expect(err).toBeInstanceOf(RecipientRateLimitedException);
    expect(err?.code).toBe('RECIPIENT_RATE_LIMITED');
    expect(err?.getStatus()).toBe(429);
  });
});
