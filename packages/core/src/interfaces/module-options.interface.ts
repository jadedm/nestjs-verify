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
