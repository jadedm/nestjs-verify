/**
 * Centralized telemetry constants. Defaults can be overridden at module
 * configuration time via observability options.
 *
 * Span names and attribute keys follow OpenTelemetry semantic-conventions
 * style: dotted, lowercase, namespaced by `verify.*` for things this
 * library is the source of truth for.
 */

/**
 * Build-time injected package version. Defined via tsup's `define` config
 * so the value tracks package.json automatically. The fallback is only
 * used in the rare case of running the source directly without a build.
 */
declare const __PACKAGE_VERSION__: string | undefined;

export const TELEMETRY = {
  /** Default OpenTelemetry tracer name. Overridable via observability.tracing.serviceName. */
  DEFAULT_TRACER_NAME: '@jadedm/nestjs-verify',
  /** Tracer version, synced to package.json at build time. */
  DEFAULT_TRACER_VERSION:
    typeof __PACKAGE_VERSION__ !== 'undefined' ? __PACKAGE_VERSION__ : '0.0.0',

  // Span names
  SPAN_VERIFY_START: 'verify.start',
  SPAN_VERIFY_CHECK: 'verify.check',
  SPAN_VERIFY_SEND_CODE: 'verify.send_code',

  // Attribute keys
  ATTR_PHONE_REDACTED: 'verify.phone_redacted',
  ATTR_CHANNEL: 'verify.channel',
  ATTR_OUTCOME: 'verify.outcome',
  ATTR_SID: 'verify.sid',
  ATTR_PROVIDER: 'verify.provider',
  ATTR_CLIENT_IP: 'http.client_ip',
} as const;

export const METRICS = {
  /** Default counter / histogram name prefix. Overridable via observability.metrics.prefix. */
  DEFAULT_PREFIX: 'verify_',

  // Names (relative to prefix)
  COUNTER_STARTS: 'starts_total',
  COUNTER_STARTS_BLOCKED: 'starts_blocked_total',
  COUNTER_CHECKS: 'checks_total',
  COUNTER_PHONE_RATE_LIMIT_HITS: 'phone_rate_limit_hits_total',
  HIST_SMS_SEND_DURATION: 'sms_send_duration_seconds',
  HIST_CHECK_DURATION: 'check_duration_seconds',

  // Label keys
  LABEL_REASON: 'reason',
  LABEL_OUTCOME: 'outcome',
  LABEL_PROVIDER: 'provider',
} as const;

/** Reasons for verify_starts_blocked_total. */
export const BLOCK_REASON = {
  Cooldown: 'cooldown',
  PhoneRateLimit: 'phone_rate_limit',
  IpRateLimit: 'ip_rate_limit',
  Abuse: 'abuse',
} as const;
export type BlockReason = (typeof BLOCK_REASON)[keyof typeof BLOCK_REASON];

/** Outcomes for verify_checks_total. */
export const CHECK_OUTCOME = {
  Approved: 'approved',
  WrongCode: 'wrong_code',
  LockedOut: 'locked_out',
  Expired: 'expired',
  NoPending: 'no_pending',
} as const;
export type CheckOutcome = (typeof CHECK_OUTCOME)[keyof typeof CHECK_OUTCOME];

/** Outcomes for verify_sms_send_duration_seconds. */
export const SMS_OUTCOME = {
  Success: 'success',
  Failure: 'failure',
} as const;
export type SmsOutcome = (typeof SMS_OUTCOME)[keyof typeof SMS_OUTCOME];
