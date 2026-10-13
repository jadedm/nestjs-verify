import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { Registry } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerifyService } from './verify.service.js';
import { createMemoryStores } from './store/create-memory-stores.js';
import { MemoryAuditSink } from './audit/memory-audit.sink.js';
import { LoggerAuditSink } from './audit/logger-audit.sink.js';
import { MockEmailProvider } from './providers/mock-email.provider.js';
import { MockSmsProvider } from './providers/mock-sms.provider.js';
import { createMetricsRecorder } from './metrics/metrics.js';
import type { VerifyModuleOptions } from './interfaces/module-options.interface.js';

const CODE = '424242';
const PHONE = '+14155552671';
const EMAIL = 'someone@example.com';
const IP = '203.0.113.7';

// prom-client puts the series name (with _count, _bucket) on histogram values
// but leaves it off the public type.
type Value = { value: number; labels: Record<string, string | number>; metricName?: string };

describe('VerifyService metrics and telemetry names (#7)', () => {
  let stores: ReturnType<typeof createMemoryStores> & { audit: MemoryAuditSink };
  let registry: Registry;

  const build = (extra: Partial<VerifyModuleOptions> = {}, reg: Registry = registry) =>
    new VerifyService({
      sms: { provider: new MockSmsProvider({ logToConsole: false }) },
      email: { provider: new MockEmailProvider({ logToConsole: false }) },
      stores,
      code: { fixedCode: CODE },
      attempts: { max: 3, cooldownSeconds: 0 },
      observability: { metrics: { enabled: true, registry: reg } },
      ...extra,
    } as VerifyModuleOptions);

  const values = async (name: string, reg: Registry = registry): Promise<Value[]> =>
    ((await reg.getMetricsAsJSON()).find((m) => m.name === name)?.values ?? []) as Value[];
  const valueOf = async (name: string, labels: Record<string, string>, reg: Registry = registry, series = name) => {
    const match = (await values(name, reg)).filter(
      (v) => (v.metricName ?? name) === series && Object.entries(labels).every(([k, l]) => v.labels[k] === l),
    );
    return match.reduce((sum, v) => sum + v.value, 0);
  };

  beforeEach(() => {
    stores = { ...createMemoryStores(), audit: new MemoryAuditSink() };
    registry = new Registry();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. counts starts per channel', async () => {
    const service = build();
    await service.start({ to: PHONE });
    await service.start({ to: EMAIL, channel: 'email' });
    expect(await valueOf('verify_starts_total', { channel: 'sms' })).toBe(1);
    expect(await valueOf('verify_starts_total', { channel: 'email' })).toBe(1);
  });

  it('2. times every send under send_duration_seconds by channel, and only SMS under the old histogram', async () => {
    const service = build();
    await service.start({ to: EMAIL, channel: 'email' });
    await service.start({ to: PHONE });
    const count = (labels: Record<string, string>) =>
      valueOf('verify_send_duration_seconds', labels, registry, 'verify_send_duration_seconds_count');
    expect(await count({ channel: 'email', provider: 'mock-email', outcome: 'success' })).toBe(1);
    expect(await count({ channel: 'sms', outcome: 'success' })).toBe(1);
    expect(await valueOf('verify_sms_send_duration_seconds', {}, registry, 'verify_sms_send_duration_seconds_count')).toBe(1);
  });

  it('3. a recipient over its limit is counted as recipient_rate_limit, and audited so', async () => {
    const service = build({ rateLimit: { perRecipient: { count: 1, windowSeconds: 60 } } });
    await service.start({ to: EMAIL, channel: 'email' });
    await service.start({ to: EMAIL, channel: 'email' }).catch(() => undefined);
    expect(await valueOf('verify_starts_blocked_total', { reason: 'recipient_rate_limit', channel: 'email' })).toBe(1);
    expect((await values('verify_starts_blocked_total')).some((v) => v.labels.reason === 'phone_rate_limit')).toBe(false);
    expect(stores.audit.events.find((e) => e.type === 'rate_limited')?.outcome).toBe('recipient_rate_limit');
  });

  it('4 and 13. counts and times checks per channel', async () => {
    const service = build();
    await service.start({ to: EMAIL, channel: 'email' });
    await service.start({ to: PHONE });
    await service.check({ to: EMAIL, code: CODE });
    await service.check({ to: PHONE, code: '000000' });
    expect(await valueOf('verify_checks_total', { outcome: 'approved', channel: 'email' })).toBe(1);
    expect(await valueOf('verify_checks_total', { outcome: 'wrong_code', channel: 'sms' })).toBe(1);
    const count = (channel: string) =>
      valueOf('verify_check_duration_seconds', { channel }, registry, 'verify_check_duration_seconds_count');
    expect(await count('email')).toBe(1);
    expect(await count('sms')).toBe(1);
  });

  it('5. advances the new rate-limit counter by channel and the old one with it', async () => {
    const service = build();
    await service.start({ to: PHONE });
    await service.start({ to: EMAIL, channel: 'email' });
    expect(await valueOf('verify_recipient_rate_limit_hits_total', { channel: 'sms' })).toBe(1);
    expect(await valueOf('verify_recipient_rate_limit_hits_total', { channel: 'email' })).toBe(1);
    expect(await valueOf('verify_phone_rate_limit_hits_total', {})).toBe(2);
  });

  it('6 and 12. sets both recipient attribute names on spans, and the channel on the check span', async () => {
    const spans: Array<{ name: string; attributes: Record<string, unknown> }> = [];
    vi.spyOn(trace, 'getTracer').mockReturnValue({
      startActiveSpan: (name: string, fn: (span: unknown) => unknown) => {
        const record = { name, attributes: {} as Record<string, unknown> };
        spans.push(record);
        return fn({
          setAttribute: (k: string, v: unknown) => (record.attributes[k] = v),
          setAttributes: (a: Record<string, unknown>) => Object.assign(record.attributes, a),
          setStatus: () => undefined,
          recordException: () => undefined,
          end: () => undefined,
        });
      },
    } as never);
    const service = build();
    await service.start({ to: EMAIL, channel: 'email' });
    await service.check({ to: EMAIL, code: CODE });
    for (const name of ['verify.start', 'verify.send_code', 'verify.check']) {
      const span = spans.find((s) => s.name === name)!;
      expect(span.attributes['verify.recipient_redacted']).toBe('s***@example.com');
      expect(span.attributes['verify.phone_redacted']).toBe('s***@example.com');
    }
    expect(spans.find((s) => s.name === 'verify.check')!.attributes['verify.channel']).toBe('email');
  });

  it('7. a velocity block audits distinctRecipients, and distinctPhones with the same value', async () => {
    const service = build({ abuse: { maxDistinctRecipientsPerIp: 1 } });
    await service.start({ to: PHONE, ip: IP });
    await service.start({ to: EMAIL, channel: 'email', ip: IP }).catch(() => undefined);
    const event = stores.audit.events.find((e) => e.type === 'abuse_detected')!;
    expect(event.meta).toEqual({ distinctRecipients: 1, distinctPhones: 1 });
  });

  it('8. LoggerAuditSink logs the recipient under both keys', async () => {
    const lines: unknown[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args);
    });
    await new LoggerAuditSink().record({ type: 'verification_started', recipientRedacted: 's***@example.com', channel: 'email', ts: new Date() });
    const payload = (lines.flat() as unknown[]).find((a) => typeof a === 'string' && a.startsWith('{')) as string;
    expect(JSON.parse(payload)).toMatchObject({ recipient: 's***@example.com', phone: 's***@example.com' });
  });

  it('9. disabled metrics record nothing and do not fail', async () => {
    const service = build({ observability: { metrics: { enabled: false, registry } } });
    await service.start({ to: PHONE });
    expect((await registry.getMetricsAsJSON()).length).toBe(0);
  });

  it('10. a custom prefix applies to the new names', async () => {
    const service = build({ observability: { metrics: { enabled: true, registry, prefix: 'otp_' } } });
    await service.start({ to: PHONE });
    expect(await valueOf('otp_send_duration_seconds', { channel: 'sms' }, registry, 'otp_send_duration_seconds_count')).toBe(1);
    expect(await valueOf('otp_recipient_rate_limit_hits_total', { channel: 'sms' })).toBe(1);
  });

  it('11. two services on one registry share its collectors', async () => {
    const first = build();
    const second = build();
    await first.start({ to: PHONE });
    await second.start({ to: '+14155552672' });
    expect(await valueOf('verify_starts_total', { channel: 'sms' })).toBe(2);
  });

  it('11b. refuses a collector already registered under the name with other labels', () => {
    const shared = new Registry();
    new (require('prom-client').Counter)({ name: 'verify_starts_total', help: 'x', labelNames: ['other'], registers: [shared] });
    expect(() => createMetricsRecorder({ enabled: true, registry: shared })).toThrow(
      'metric verify_starts_total is already registered with labels [other], not [channel]',
    );
  });

  it('11c. refuses a collector already registered under the name as another metric type', () => {
    const prom = require('prom-client');
    for (const [Type, name, labelNames, type] of [
      [prom.Histogram, 'verify_starts_total', ['channel'], 'histogram'],
      [prom.Gauge, 'verify_starts_total', ['channel'], 'gauge'],
      [prom.Summary, 'verify_check_duration_seconds', ['channel'], 'summary'],
    ] as const) {
      const shared = new Registry();
      new Type({ name, help: 'x', labelNames, registers: [shared] });
      expect(() => createMetricsRecorder({ enabled: true, registry: shared })).toThrow(`metric ${name} is already registered as a ${type}`);
    }
  });

  it('13b. labels expired and locked-out checks, and cooldown, IP-limit and abuse blocks, by channel', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const service = build({
      code: { fixedCode: CODE, ttlSeconds: 60 },
      attempts: { max: 1, cooldownSeconds: 30 },
      rateLimit: { perIp: { count: 2, windowSeconds: 60 } },
      abuse: { maxDistinctRecipientsPerIp: 1 },
    });
    await service.start({ to: EMAIL, channel: 'email', ip: IP });
    await service.check({ to: EMAIL, code: '000000' });
    await service.start({ to: EMAIL, channel: 'email' }).catch(() => undefined);
    await service.start({ to: 'other@example.com', channel: 'email', ip: IP }).catch(() => undefined);
    await service.start({ to: 'third@example.com', channel: 'email', ip: IP }).catch(() => undefined);
    await service.start({ to: PHONE });
    // A record past its deadline that the stores still return, as a database
    // store does when the app clock runs ahead of the database's; the memory
    // stores would drop the index entry and mark the record themselves.
    const sid = (await stores.recipientIndex.get(PHONE))!;
    const stored = (await stores.verify.get(sid))!;
    vi.spyOn(stores.recipientIndex, 'get').mockResolvedValue(sid);
    vi.spyOn(stores.verify, 'get').mockResolvedValue(stored);
    vi.setSystemTime(Date.now() + 120_000);
    await service.check({ to: PHONE, code: CODE }).catch(() => undefined);
    vi.useRealTimers();
    expect(await valueOf('verify_checks_total', { outcome: 'locked_out', channel: 'email' })).toBe(1);
    expect(await valueOf('verify_checks_total', { outcome: 'expired', channel: 'sms' })).toBe(1);
    expect(await valueOf('verify_starts_blocked_total', { reason: 'cooldown', channel: 'email' })).toBe(1);
    expect(await valueOf('verify_starts_blocked_total', { reason: 'abuse', channel: 'email' })).toBe(1);
    expect(await valueOf('verify_starts_blocked_total', { reason: 'ip_rate_limit', channel: 'email' })).toBe(1);
    expect((await values('verify_starts_blocked_total')).some((v) => v.labels.channel === 'unknown')).toBe(false);
  });

  it('14. the deprecated recorder methods still record, through the new ones', async () => {
    const recorder = createMetricsRecorder({ enabled: true, registry });
    recorder.phoneRateLimitHits();
    recorder.smsSendDuration('p', 'success', 0.1);
    expect(await valueOf('verify_recipient_rate_limit_hits_total', { channel: 'unknown' })).toBe(1);
    expect(await valueOf('verify_phone_rate_limit_hits_total', {})).toBe(1);
    expect(await valueOf('verify_send_duration_seconds', { channel: 'sms', provider: 'p' }, registry, 'verify_send_duration_seconds_count')).toBe(1);
    expect(await valueOf('verify_sms_send_duration_seconds', { provider: 'p' }, registry, 'verify_sms_send_duration_seconds_count')).toBe(1);
  });
});
