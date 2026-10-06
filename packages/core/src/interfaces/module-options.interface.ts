import { ModuleMetadata, Type } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface.js';
import { EmailProvider } from './email-provider.interface.js';
import { VerifyStore } from './verify-store.interface.js';
import { AbuseStore } from './abuse-store.interface.js';
import { RateLimitStore } from './rate-limit-store.interface.js';
import { CooldownStore } from './cooldown-store.interface.js';
import { PhoneIndexStore } from './phone-index-store.interface.js';
import { AuditSink } from './audit-sink.interface.js';

export interface RateLimitPolicy {
  count: number;
  windowSeconds: number;
}

export interface VerifyModuleOptions {
  /** SMS delivery. At least one of `sms` or `email` is required. */
  sms?: {
    provider: SmsProvider;
    /** Optional fallback chain. Tried in order if primary fails. */
    fallbacks?: SmsProvider[];
  };
  /**
   * Email delivery, used when a verification starts with `channel: 'email'`.
   * Store fields named `phone` then hold the email address.
   */
  email?: {
    provider: EmailProvider;
    /** Optional fallback chain. Tried in order if primary fails. */
    fallbacks?: EmailProvider[];
    /** Subject line. {{code}} is replaced. Default 'Your verification code'. */
    subject?: string;
    /** Plain-text body. {{code}} is replaced. Defaults to `messageTemplate`. */
    template?: string;
  };
  stores: {
    verify: VerifyStore;
    abuse?: AbuseStore;
    rateLimit: RateLimitStore;
    cooldown: CooldownStore;
    phoneIndex: PhoneIndexStore;
    /**
     * Optional. When provided, lifecycle events for every verification
     * (started, dispatched, approved, canceled, rate-limited, abuse-detected)
     * are emitted to this sink.
     */
    audit?: AuditSink;
  };
  observability?: {
    tracing?: {
      /**
       * 'auto' (default): use any OpenTelemetry SDK registered in the host
       * application. If no SDK is registered, the no-op tracer runs and
       * spans are not emitted. Zero config in either case.
       * true: same as 'auto'.
       * false: never emit spans, skip even the no-op overhead.
       */
      enabled?: 'auto' | boolean;
      /** Service name attribute on every span. Default 'nestjs-verify'. */
      serviceName?: string;
    };
    metrics?: {
      /** Default false. Opt in explicitly. */
      enabled?: boolean;
      /**
       * Pass an existing prom-client Registry. If absent, a new one is
       * created and exposed via VerifyService.getMetricsRegistry().
       */
      registry?: unknown;
      /** Counter / histogram name prefix. Default 'verify_'. */
      prefix?: string;
    };
  };
  code?: {
    /** Digits per OTP. Default 6. */
    length?: number;
    /** Time the code stays valid. Default 600s. */
    ttlSeconds?: number;
    /**
     * **Development/testing only.** When set, every verification uses this
     * code instead of generating a random one. Logs a loud warning at boot.
     * Never set this in production.
     */
    fixedCode?: string;
  };
  attempts?: {
    /** Max wrong codes before lockout. Default 5. */
    max?: number;
    /** Cooldown after a send before allowing another. Default 30s. */
    cooldownSeconds?: number;
  };
  /**
   * How long a send may take. An attempt that runs past its limit counts as a
   * failure and the next provider in the chain is tried; its signal is
   * aborted. A request already in flight may still deliver, so a fallback can
   * send a second message carrying the same code.
   */
  delivery?: {
    /** Limit for one provider attempt, in ms. Default 5000. */
    attemptTimeoutMs?: number;
    /** Limit for the whole provider chain, in ms. Default 10000. */
    totalTimeoutMs?: number;
  };
  rateLimit?: {
    perPhone?: RateLimitPolicy;
    perIp?: RateLimitPolicy;
  };
  abuse?: {
    /** Max distinct phones a single IP may verify in window. */
    maxDistinctPhonesPerIp?: number;
    velocityWindowSeconds?: number;
  };
  /**
   * Mount the built-in /verify controller. Default true. With `forRootAsync`,
   * set `registerController` on the async options instead. A `false` returned
   * from `useFactory` cannot keep the controller from being registered: its
   * routes then answer 404, and an error is logged at startup.
   */
  registerController?: boolean;
  /** SMS body template. {{code}} is replaced. Also the email body when `email.template` is unset. */
  messageTemplate?: string;
  logging?: {
    /**
     * Emit detailed step-by-step logs for every verification (rate-limit hits,
     * code dispatch, attempt counts, etc.). When false (default), these only
     * surface if Nest is started with logger: ['verbose', ...]. When true,
     * they always emit at `log` level — useful for debugging without
     * touching the global Nest log config.
     */
    verbose?: boolean;
  };
}

export interface VerifyModuleAsyncOptions
  extends Pick<ModuleMetadata, 'imports'> {
  /**
   * Mount the built-in /verify controller. Default true. Set it here, not in
   * the `useFactory` result: the controller list is fixed before the factory
   * runs, so a `false` from the factory only makes the routes answer 404.
   */
  registerController?: boolean;
  inject?: any[];
  useFactory: (
    ...args: any[]
  ) => Promise<VerifyModuleOptions> | VerifyModuleOptions;
  extraProviders?: any[];
}

export const VERIFY_MODULE_OPTIONS = Symbol('VERIFY_MODULE_OPTIONS');
