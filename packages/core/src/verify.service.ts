import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

class TooManyRequestsException extends HttpException {
  constructor(response: string | Record<string, unknown>) {
    super(response, HttpStatus.TOO_MANY_REQUESTS);
  }
}
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import { VERIFY_MODULE_OPTIONS } from './interfaces/module-options.interface.js';
import type { VerifyModuleOptions } from './interfaces/module-options.interface.js';
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
import { CacheRateLimiter } from './store/cache-rate-limiter.js';
import { CooldownTracker } from './store/cooldown.js';

export interface StartParams {
  to: string;
  channel?: VerificationChannel;
  ip?: string;
}

export interface StartResult {
  sid: string;
  status: 'pending';
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
  status: 'approved' | 'pending' | 'canceled';
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
  messageTemplate: 'Your verification code is {{code}}. It expires in 10 minutes.',
} as const;

@Injectable()
export class VerifyService {
  private readonly log = new Logger(VerifyService.name);
  private readonly rateLimiter: CacheRateLimiter;
  private readonly cooldown: CooldownTracker;
  /** Resolves phone → most-recent sid, so check() doesn't need the sid. */
  private readonly phoneIndexKey = (phone: string) => `verify:idx:${phone}`;

  constructor(
    @Inject(VERIFY_MODULE_OPTIONS)
    private readonly options: VerifyModuleOptions,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {
    this.rateLimiter = new CacheRateLimiter(cache);
    this.cooldown = new CooldownTracker(cache);
  }

  async start(params: StartParams): Promise<StartResult> {
    const phone = this.normalizePhone(params.to);
    const channel = params.channel ?? 'sms';

    if (await this.cooldown.isOnCooldown(phone)) {
      throw new TooManyRequestsException({
        code: 'COOLDOWN_ACTIVE',
        message: 'A code was sent recently. Please wait before requesting another.',
      });
    }

    await this.enforceRateLimits(phone, params.ip);
    await this.enforceAbuseHeuristics(phone, params.ip);

    const codeLength = this.options.code?.length ?? DEFAULTS.codeLength;
    const ttlSeconds = this.options.code?.ttlSeconds ?? DEFAULTS.ttlSeconds;
    const maxAttempts =
      this.options.attempts?.max ?? DEFAULTS.maxAttempts;
    const cooldownSeconds =
      this.options.attempts?.cooldownSeconds ?? DEFAULTS.cooldownSeconds;

    const code = generateCode(codeLength);
    const salt = generateSalt();
    const sid = generateSid();
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
    await this.cache.set(
      this.phoneIndexKey(phone),
      sid,
      ttlSeconds * 1000,
    );

    try {
      await this.sendCode(phone, code);
      await this.cooldown.start(phone, cooldownSeconds);
      await this.options.stores.abuse?.recordSendAttempt({
        sid,
        phone,
        ip: params.ip,
        channel,
        provider: this.options.sms.provider.name,
        success: true,
      });
    } catch (err) {
      await this.options.stores.verify.delete(sid);
      await this.options.stores.abuse?.recordSendAttempt({
        sid,
        phone,
        ip: params.ip,
        channel,
        provider: this.options.sms.provider.name,
        success: false,
        errorCode: (err as Error).message,
      });
      throw new ServiceUnavailableException({
        code: 'SMS_DISPATCH_FAILED',
        message: 'Unable to dispatch verification code. Please try again.',
      });
    }

    return {
      sid,
      status: 'pending',
      channel,
      expiresAt: record.expiresAt,
    };
  }

  async check(params: CheckParams): Promise<CheckResult> {
    const phone = this.normalizePhone(params.to);
    const sid = await this.cache.get<string>(this.phoneIndexKey(phone));
    if (!sid) {
      throw new BadRequestException({
        code: 'NO_PENDING_VERIFICATION',
        message: 'No active verification for this number.',
      });
    }

    const record = await this.options.stores.verify.get(sid);
    if (!record) {
      throw new BadRequestException({
        code: 'NO_PENDING_VERIFICATION',
        message: 'No active verification for this number.',
      });
    }

    if (record.status !== 'pending') {
      return {
        sid,
        status: record.status === 'approved' ? 'approved' : 'canceled',
        attemptsRemaining: 0,
      };
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      await this.options.stores.verify.markStatus(sid, 'expired');
      throw new BadRequestException({
        code: 'CODE_EXPIRED',
        message: 'The code has expired. Request a new one.',
      });
    }

    const expectedHash = hashCode(params.code, record.salt);
    const match = constantTimeEqual(expectedHash, record.codeHash);

    if (match) {
      const transitioned = await this.options.stores.verify.markStatus(
        sid,
        'approved',
      );
      await this.cache.del(this.phoneIndexKey(phone));
      return {
        sid,
        status: transitioned ? 'approved' : 'canceled',
        attemptsRemaining: 0,
      };
    }

    const { record: updated, outcome } =
      await this.options.stores.verify.incrementAttempts(sid);
    const attemptsRemaining = updated
      ? Math.max(0, updated.maxAttempts - updated.attempts)
      : 0;

    if (outcome === 'locked-out') {
      await this.cache.del(this.phoneIndexKey(phone));
      return { sid, status: 'canceled', attemptsRemaining: 0 };
    }
    return { sid, status: 'pending', attemptsRemaining };
  }

  private async sendCode(phone: string, code: string): Promise<void> {
    const template =
      this.options.messageTemplate ?? DEFAULTS.messageTemplate;
    const body = template.replace('{{code}}', code);
    const providers = [
      this.options.sms.provider,
      ...(this.options.sms.fallbacks ?? []),
    ];
    let lastError: unknown;
    for (const provider of providers) {
      try {
        await provider.send({ to: phone, body });
        return;
      } catch (err) {
        lastError = err;
        this.log.warn(
          `provider ${provider.name} failed for ${this.redact(phone)}: ${
            (err as Error).message
          }`,
        );
      }
    }
    throw lastError ?? new Error('All SMS providers failed');
  }

  private async enforceRateLimits(
    phone: string,
    ip: string | undefined,
  ): Promise<void> {
    const perPhone =
      this.options.rateLimit?.perPhone ?? DEFAULTS.perPhone;
    const phoneHits = await this.rateLimiter.hit(
      'phone',
      phone,
      perPhone.windowSeconds,
    );
    if (phoneHits > perPhone.count) {
      throw new TooManyRequestsException({
        code: 'PHONE_RATE_LIMITED',
        message: 'Too many verification requests for this number.',
      });
    }
    if (ip) {
      const perIp = this.options.rateLimit?.perIp ?? DEFAULTS.perIp;
      const ipHits = await this.rateLimiter.hit(
        'ip',
        ip,
        perIp.windowSeconds,
      );
      if (ipHits > perIp.count) {
        throw new TooManyRequestsException({
          code: 'IP_RATE_LIMITED',
          message: 'Too many verification requests from this network.',
        });
      }
    }
  }

  private async enforceAbuseHeuristics(
    phone: string,
    ip: string | undefined,
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
      throw new TooManyRequestsException({
        code: 'ABUSE_VELOCITY',
        message: 'Suspicious request pattern detected.',
      });
    }
  }

  private normalizePhone(input: string): string {
    const trimmed = input.trim().replace(/\s+/g, '');
    if (!/^\+\d{6,15}$/.test(trimmed)) {
      throw new BadRequestException({
        code: 'INVALID_PHONE',
        message: 'Phone must be E.164 format, e.g. +14155552671.',
      });
    }
    return trimmed;
  }

  private redact(phone: string): string {
    return phone.slice(0, 4) + '***' + phone.slice(-2);
  }
}
