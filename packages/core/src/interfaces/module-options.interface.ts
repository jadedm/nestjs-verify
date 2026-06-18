import { ModuleMetadata, Type } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface.js';
import { VerifyStore } from './verify-store.interface.js';
import { AbuseStore } from './abuse-store.interface.js';

export interface RateLimitPolicy {
  count: number;
  windowSeconds: number;
}

export interface VerifyModuleOptions {
  sms: {
    provider: SmsProvider;
    /** Optional fallback chain. Tried in order if primary fails. */
    fallbacks?: SmsProvider[];
  };
  stores: {
    verify: VerifyStore;
    abuse?: AbuseStore;
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
  rateLimit?: {
    perPhone?: RateLimitPolicy;
    perIp?: RateLimitPolicy;
  };
  abuse?: {
    /** Max distinct phones a single IP may verify in window. */
    maxDistinctPhonesPerIp?: number;
    velocityWindowSeconds?: number;
  };
  /** Mount the built-in /verify controller. Default true. */
  registerController?: boolean;
  /** Body template. {{code}} is replaced. */
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
  inject?: any[];
  useFactory: (
    ...args: any[]
  ) => Promise<VerifyModuleOptions> | VerifyModuleOptions;
  extraProviders?: any[];
}

export const VERIFY_MODULE_OPTIONS = Symbol('VERIFY_MODULE_OPTIONS');
