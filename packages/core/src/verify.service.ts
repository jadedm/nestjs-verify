import { Inject, Injectable, Logger } from '@nestjs/common';

import { VERIFY_MODULE_OPTIONS } from './interfaces/module-options.interface.js';
import type { VerifyModuleOptions } from './interfaces/module-options.interface.js';
import { asyncHandler } from './utils/async-handler.js';
import { DeliveryTimeoutError, withDeadline } from './utils/deadline.js';
import { withSpan } from './tracing/tracer.js';
import { TELEMETRY, BLOCK_REASON, CHECK_OUTCOME, SMS_OUTCOME } from './constants.js';
import {
  createMetricsRecorder,
  MetricsRecorder,
} from './metrics/metrics.js';
import {
  AbuseVelocityException,
  CodeExpiredException,
  CooldownActiveException,
  IpRateLimitedException,
  NoPendingVerificationException,
  PhoneRateLimitedException,
  SmsDispatchFailedException,
} from './errors.js';
import type {
  VerificationChannel,
  VerificationRecord,
} from './interfaces/verify-store.interface.js';
import {
  constantTimeEqual,
  generateCode,
  generateSalt,
  generateSid,
  hashCode,
} from './code/code-gen.js';
import { buildDeliverers, Deliverer } from './dispatch.js';
import {
  DeliveryKind,
  Recipient,
  recipientFor,
  recipientFromAddress,
  redact,
} from './recipient.js';

export interface StartParams {
  to: string;
  channel?: VerificationChannel;
  ip?: string;
}

export interface StartResult {
  sid: string;
  /**
   * Verification state on the wire. Distinct field name from `status` to
   * avoid collision with JSend-style envelopes ({ status: "success", ... }).
   */
  state: 'pending';
  channel: VerificationChannel;
  expiresAt: Date;
}

export interface CheckParams {
  to: string;
  code: string;
  ip?: string;
}

export interface CheckResult {
  sid: string;
  state: 'approved' | 'pending' | 'canceled';
  attemptsRemaining: number;
}

const DEFAULTS = {
  codeLength: 6,
  ttlSeconds: 600,
  maxAttempts: 5,
  cooldownSeconds: 30,
  perPhone: { count: 5, windowSeconds: 3600 },
  perIp: { count: 20, windowSeconds: 3600 },
  maxDistinctPhonesPerIp: 10,
  velocityWindowSeconds: 300,
  attemptTimeoutMs: 5000,
  totalTimeoutMs: 10000,
} as const;

// setTimeout treats a delay above 2^31-1 ms as 1 ms, so a larger limit would
// time every attempt out at once.
const MAX_TIMER_MS = 2_147_483_647;
const isValidLimitMs = (ms: number) => Number.isFinite(ms) && ms > 0 && ms <= MAX_TIMER_MS;
// Timers fire a little early or late against performance.now(), so the budget
// can end with a sliver left. No provider is started with less than this.
const MIN_ATTEMPT_WINDOW_MS = 10;

@Injectable()
export class VerifyService {
  private readonly log = new Logger(VerifyService.name);
  private readonly metrics: MetricsRecorder;
  private readonly deliverers: Map<DeliveryKind, Deliverer[]>;
  private readonly attemptTimeoutMs: number;
  private readonly totalTimeoutMs: number;

  constructor(
    @Inject(VERIFY_MODULE_OPTIONS)
    private readonly options: VerifyModuleOptions,
  ) {
    this.deliverers = buildDeliverers(options);
    this.attemptTimeoutMs = options.delivery?.attemptTimeoutMs ?? DEFAULTS.attemptTimeoutMs;
    this.totalTimeoutMs = options.delivery?.totalTimeoutMs ?? DEFAULTS.totalTimeoutMs;
    if (!isValidLimitMs(this.attemptTimeoutMs) || !isValidLimitMs(this.totalTimeoutMs)) {
      throw new Error(
        `delivery.attemptTimeoutMs and delivery.totalTimeoutMs must be positive, finite numbers of milliseconds, at most ${MAX_TIMER_MS}.`,
      );
    }
    this.metrics = createMetricsRecorder({
      enabled: options.observability?.metrics?.enabled,
      registry: options.observability?.metrics?.registry,
      prefix: options.observability?.metrics?.prefix,
    });
    if (options.logging?.verbose) {
      this.log.log('verbose logging enabled (logging.verbose = true)');
    }
    if (options.code?.fixedCode) {
      const env = process.env.NODE_ENV;
      const msg = `code.fixedCode is set ("${options.code.fixedCode}"); every verification will use this static code.`;
      if (env === 'production') {
        this.log.error(msg + ' This is UNSAFE in production.');
      } else {
        this.log.warn(msg);
      }
    }
  }

  /**
   * Returns the prom-client Registry holding the metrics this service
   * emits. Undefined when metrics are disabled. Wire it to your /metrics
   * controller, e.g.:
   *
   *   @Get('metrics')
   *   metrics() {
   *     const reg = verify.getMetricsRegistry();
   *     return reg?.metrics() ?? '';
   *   }
   */
  getMetricsRegistry(): unknown {
    return this.metrics.getRegistry();
  }

  async start(params: StartParams): Promise<StartResult> {
    return withSpan(
      TELEMETRY.SPAN_VERIFY_START,
      {
        attributes: {
          [TELEMETRY.ATTR_CHANNEL]: params.channel ?? 'sms',
          [TELEMETRY.ATTR_CLIENT_IP]: params.ip,
        },
      },
      (span) => this._startImpl(params, span),
      this.options.observability?.tracing?.serviceName,
    );
  }

  private async _startImpl(
    params: StartParams,
    span: import('@opentelemetry/api').Span,
  ): Promise<StartResult> {
    const channel = params.channel ?? 'sms';
    const recipient = recipientFor(
      params.to,
      channel,
      new Set(this.deliverers.keys()),
    );
    const phone = recipient.key;
    span.setAttribute(TELEMETRY.ATTR_PHONE_REDACTED, this.redact(phone));
    this.vlog(`start: phone=${this.redact(phone)} channel=${channel} ip=${params.ip ?? '-'}`);

    const cooldownMs = await this.options.stores.cooldown.remaining(phone);
    if (cooldownMs > 0) {
      this.vlog(`start: blocked by cooldown for phone=${this.redact(phone)} remainingMs=${cooldownMs}`);
      this.metrics.startsBlocked(BLOCK_REASON.Cooldown);
      await this.audit({
        type: 'rate_limited',
        phoneRedacted: this.redact(phone),
        ip: params.ip,
        channel,
        outcome: 'cooldown',
        meta: { retryAfterMs: cooldownMs },
      });
      throw new CooldownActiveException(cooldownMs);
    }

    await this.enforceRateLimits(phone, params.ip, channel);
    await this.enforceAbuseHeuristics(phone, params.ip, channel);

    const codeLength = this.options.code?.length ?? DEFAULTS.codeLength;
    const ttlSeconds = this.options.code?.ttlSeconds ?? DEFAULTS.ttlSeconds;
    const maxAttempts =
      this.options.attempts?.max ?? DEFAULTS.maxAttempts;
    const cooldownSeconds =
      this.options.attempts?.cooldownSeconds ?? DEFAULTS.cooldownSeconds;

    const code = this.options.code?.fixedCode ?? generateCode(codeLength);
    const salt = generateSalt();
    const sid = generateSid();
    span.setAttribute(TELEMETRY.ATTR_SID, sid);
    const now = new Date();
    const record: VerificationRecord = {
      sid,
      phone,
      channel,
      codeHash: hashCode(code, salt),
      salt,
      attempts: 0,
      maxAttempts,
      status: 'pending',
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
    };

    await this.options.stores.verify.create(record);
    await this.options.stores.phoneIndex.set(phone, sid, ttlSeconds);

    this.vlog(`start: persisted sid=${sid} attemptsMax=${maxAttempts} ttl=${ttlSeconds}s; dispatching code`);
    await this.audit({
      type: 'verification_started',
      sid,
      phoneRedacted: this.redact(phone),
      ip: params.ip,
      channel,
    });
    // The send and the bookkeeping that must follow it fail together: if the
    // cooldown or the send record cannot be written, the verification is
    // removed and the caller gets 503. The code may
    // already have been delivered, so a retry can send a second one; only the
    // per-recipient rate limit counts it.
    const [provider, sendErr] = await asyncHandler(
      this.sendCode(recipient, code).then(async (sentBy) => {
        await this.options.stores.cooldown.start(phone, cooldownSeconds);
        await this.options.stores.abuse?.recordSendAttempt({
          sid,
          phone,
          ip: params.ip,
          channel,
          provider: sentBy,
          success: true,
        });
        return sentBy;
      }),
    );
    if (sendErr) {
      await this.options.stores.verify.delete(sid);
      await this.options.stores.phoneIndex.delete(phone);
      await this.options.stores.abuse?.recordSendAttempt({
        sid,
        phone,
        ip: params.ip,
        channel,
        provider: this.chainName(recipient.kind),
        success: false,
        errorCode: sendErr.message,
      });
      throw new SmsDispatchFailedException();
    }
    this.vlog(`start: dispatched sid=${sid} via ${provider}; cooldown=${cooldownSeconds}s`);
    this.metrics.startsTotal();
    await this.audit({
      type: 'code_dispatched',
      sid,
      phoneRedacted: this.redact(phone),
      ip: params.ip,
      channel,
      provider,
    });

    return {
      sid,
      state: 'pending',
      channel,
      expiresAt: record.expiresAt,
    };
  }

  async check(params: CheckParams): Promise<CheckResult> {
    return withSpan(
      TELEMETRY.SPAN_VERIFY_CHECK,
      { attributes: { [TELEMETRY.ATTR_CLIENT_IP]: params.ip } },
      (span) => this._checkImpl(params, span),
      this.options.observability?.tracing?.serviceName,
    );
  }

  private async _checkImpl(
    params: CheckParams,
    span: import('@opentelemetry/api').Span,
  ): Promise<CheckResult> {
    const checkStart = Date.now();
    const phone = recipientFromAddress(params.to).key;
    span.setAttribute(TELEMETRY.ATTR_PHONE_REDACTED, this.redact(phone));
    this.vlog(`check: phone=${this.redact(phone)} ip=${params.ip ?? '-'}`);
    const sid = await this.options.stores.phoneIndex.get(phone);
    if (!sid) {
      this.metrics.checksTotal(CHECK_OUTCOME.NoPending);
      this.metrics.checkDuration((Date.now() - checkStart) / 1000);
      throw new NoPendingVerificationException();
    }
    span.setAttribute(TELEMETRY.ATTR_SID, sid);

    const record = await this.options.stores.verify.get(sid);
    if (!record) {
      this.metrics.checksTotal(CHECK_OUTCOME.NoPending);
      this.metrics.checkDuration((Date.now() - checkStart) / 1000);
      throw new NoPendingVerificationException();
    }

    // Only the call that moves a record from pending to approved reports
    // approved. A record that is already approved, expired or canceled is
    // finished: reporting approved here, without comparing the code, would
    // let any code through while the recipient index still points at it.
    if (record.status !== 'pending') {
      return { sid, state: 'canceled', attemptsRemaining: 0 };
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      await this.options.stores.verify.markStatus(sid, 'expired');
      this.metrics.checksTotal(CHECK_OUTCOME.Expired);
      this.metrics.checkDuration((Date.now() - checkStart) / 1000);
      await this.audit({
        type: 'verification_expired',
        sid,
        phoneRedacted: this.redact(phone),
        ip: params.ip,
        channel: record.channel,
      });
      throw new CodeExpiredException();
    }

    const expectedHash = hashCode(params.code, record.salt);
    const match = constantTimeEqual(expectedHash, record.codeHash);

    if (match) {
      this.vlog(`check: code matched sid=${sid}; approving`);
      const transitioned = await this.options.stores.verify.markStatus(
        sid,
        'approved',
      );
      // The approval is already committed. A failed index cleanup must not
      // turn it into an error: later checks of this record answer canceled,
      // so a stale index entry grants nothing.
      const [, indexErr] = await asyncHandler(this.options.stores.phoneIndex.delete(phone));
      if (indexErr) this.log.warn(`check: index cleanup failed for sid=${sid}: ${indexErr.message}`);
      this.metrics.checksTotal(
        transitioned ? CHECK_OUTCOME.Approved : CHECK_OUTCOME.LockedOut,
      );
      this.metrics.checkDuration((Date.now() - checkStart) / 1000);
      await this.audit({
        type: transitioned ? 'verification_approved' : 'verification_canceled',
        sid,
        phoneRedacted: this.redact(phone),
        ip: params.ip,
        channel: record.channel,
        outcome: transitioned ? 'approved' : 'race',
      });
      return {
        sid,
        state: transitioned ? 'approved' : 'canceled',
        attemptsRemaining: 0,
      };
    }

    const { record: updated, outcome } =
      await this.options.stores.verify.incrementAttempts(sid);
    const attemptsRemaining = updated
      ? Math.max(0, updated.maxAttempts - updated.attempts)
      : 0;

    if (outcome === 'locked-out') {
      this.vlog(`check: locked out sid=${sid} after exhausting attempts`);
      await this.options.stores.phoneIndex.delete(phone);
      this.metrics.checksTotal(CHECK_OUTCOME.LockedOut);
      this.metrics.checkDuration((Date.now() - checkStart) / 1000);
      await this.audit({
        type: 'verification_canceled',
        sid,
        phoneRedacted: this.redact(phone),
        ip: params.ip,
        channel: record.channel,
        outcome: 'locked_out',
        meta: { attempts: updated?.attempts, maxAttempts: updated?.maxAttempts },
      });
      return { sid, state: 'canceled', attemptsRemaining: 0 };
    }
    this.vlog(`check: wrong code sid=${sid} attemptsRemaining=${attemptsRemaining}`);
    this.metrics.checksTotal(CHECK_OUTCOME.WrongCode);
    this.metrics.checkDuration((Date.now() - checkStart) / 1000);
    return { sid, state: 'pending', attemptsRemaining };
  }

  /**
   * Tries each provider for the recipient's kind in order; returns the one that
   * sent. Each attempt is limited to `attemptTimeoutMs` and the whole chain to
   * `totalTimeoutMs`; once the total is spent, no further provider is tried.
   */
  private async sendCode(recipient: Recipient, code: string): Promise<string> {
    const serviceName = this.options.observability?.tracing?.serviceName;
    // Monotonic, so a wall-clock step cannot stretch or shrink the budget.
    const chainStart = performance.now();
    let lastError: unknown;
    for (const deliverer of this.deliverers.get(recipient.kind) ?? []) {
      const remainingMs = this.totalTimeoutMs - (performance.now() - chainStart);
      if (remainingMs < MIN_ATTEMPT_WINDOW_MS) {
        lastError = new DeliveryTimeoutError(
          `delivery limit of ${this.totalTimeoutMs} ms reached before ${deliverer.name} was tried`,
        );
        this.log.warn(`provider ${deliverer.name} skipped for ${this.redact(recipient.key)}: total delivery limit reached`);
        break;
      }
      const limitMs = Math.min(this.attemptTimeoutMs, remainingMs);
      const sendStart = Date.now();
      const [, err] = await asyncHandler(
        withSpan(
          TELEMETRY.SPAN_VERIFY_SEND_CODE,
          {
            attributes: {
              [TELEMETRY.ATTR_PROVIDER]: deliverer.name,
              [TELEMETRY.ATTR_PHONE_REDACTED]: this.redact(recipient.key),
              [TELEMETRY.ATTR_CHANNEL]: recipient.kind,
            },
          },
          () => withDeadline(limitMs, (signal) => deliverer.deliver(recipient.address, code, signal)),
          serviceName,
        ),
      );
      const seconds = (Date.now() - sendStart) / 1000;
      // The histogram is SMS-only until it gains a channel label (#7).
      if (recipient.kind === 'sms') {
        this.metrics.smsSendDuration(
          deliverer.name,
          err ? SMS_OUTCOME.Failure : SMS_OUTCOME.Success,
          seconds,
        );
      }
      if (!err) return deliverer.name;
      lastError = err;
      this.log.warn(
        `provider ${deliverer.name} failed for ${this.redact(recipient.key)}: ${
          (err as Error).message
        }`,
      );
    }
    throw lastError ?? new Error(`All ${recipient.kind} providers failed`);
  }

  private chainName(kind: DeliveryKind): string {
    return (this.deliverers.get(kind) ?? []).map((d) => d.name).join(',');
  }

  private async enforceRateLimits(
    phone: string,
    ip: string | undefined,
    channel: VerificationChannel,
  ): Promise<void> {
    const perPhone =
      this.options.rateLimit?.perPhone ?? DEFAULTS.perPhone;
    const phoneHit = await this.options.stores.rateLimit.hit(
      `phone:${phone}`,
      perPhone.count,
      perPhone.windowSeconds,
    );
    this.metrics.phoneRateLimitHits();
    if (phoneHit.exceeded) {
      this.metrics.startsBlocked(BLOCK_REASON.PhoneRateLimit);
      await this.audit({
        type: 'rate_limited',
        phoneRedacted: this.redact(phone),
        ip,
        channel,
        outcome: 'phone_rate_limit',
        meta: { resetAt: phoneHit.resetAt },
      });
      throw new PhoneRateLimitedException(phoneHit.resetAt);
    }
    if (ip) {
      const perIp = this.options.rateLimit?.perIp ?? DEFAULTS.perIp;
      const ipHit = await this.options.stores.rateLimit.hit(
        `ip:${ip}`,
        perIp.count,
        perIp.windowSeconds,
      );
      if (ipHit.exceeded) {
        this.metrics.startsBlocked(BLOCK_REASON.IpRateLimit);
        await this.audit({
          type: 'rate_limited',
          phoneRedacted: this.redact(phone),
          ip,
          channel,
          outcome: 'ip_rate_limit',
          meta: { resetAt: ipHit.resetAt },
        });
        throw new IpRateLimitedException(ipHit.resetAt);
      }
    }
  }

  private async enforceAbuseHeuristics(
    phone: string,
    ip: string | undefined,
    channel: VerificationChannel,
  ): Promise<void> {
    if (!ip || !this.options.stores.abuse) return;
    const maxDistinct =
      this.options.abuse?.maxDistinctPhonesPerIp ??
      DEFAULTS.maxDistinctPhonesPerIp;
    const windowSeconds =
      this.options.abuse?.velocityWindowSeconds ??
      DEFAULTS.velocityWindowSeconds;
    const distinct = await this.options.stores.abuse.countDistinctPhonesByIp(
      ip,
      windowSeconds * 1000,
    );
    if (distinct >= maxDistinct) {
      this.metrics.startsBlocked(BLOCK_REASON.Abuse);
      await this.audit({
        type: 'abuse_detected',
        phoneRedacted: this.redact(phone),
        ip,
        channel,
        outcome: 'velocity',
        meta: { distinctPhones: distinct },
      });
      throw new AbuseVelocityException();
    }
  }

  private redact(key: string): string {
    return redact(key);
  }

  /**
   * Emit an audit event if a sink is configured. Wraps the sink call with
   * asyncHandler so a failing sink (e.g. transient DB error) never breaks
   * a verification. Sink errors are logged at WARN level.
   */
  private async audit(
    partial: Omit<import('./interfaces/audit-sink.interface.js').AuditEvent, 'ts'> & {
      ts?: Date;
    },
  ): Promise<void> {
    const sink = this.options.stores.audit;
    if (!sink) return;
    const event = { ts: new Date(), ...partial };
    const [, err] = await asyncHandler(sink.record(event));
    if (err) this.log.warn(`audit sink failed: ${err.message}`);
  }

  /**
   * Operational checkpoint log. Emits at `log` level when
   * `logging.verbose === true`, otherwise at `verbose` level (visible only
   * when Nest's logger includes 'verbose').
   */
  private vlog(message: string): void {
    if (this.options.logging?.verbose) this.log.log(message);
    else this.log.verbose(message);
  }
}
