export type AuditEventType =
  | 'verification_started'
  | 'code_dispatched'
  | 'verification_approved'
  | 'verification_canceled'
  | 'verification_expired'
  | 'rate_limited'
  | 'abuse_detected';

export interface AuditEvent {
  type: AuditEventType;
  /** Verification sid, when one exists. */
  sid?: string;
  /** Phone with the middle redacted (e.g. +919***10). Never raw phone. */
  phoneRedacted: string;
  /** Client IP, when available. */
  ip?: string;
  channel: string;
  provider?: string;
  /** Outcome string for the event, e.g. 'approved', 'cooldown', 'phone_rate_limit'. */
  outcome?: string;
  ts: Date;
  /** Free-form attributes for adapters that want richer audit. */
  meta?: Record<string, unknown>;
}

/**
 * Pluggable sink for audit events. Implementations can write to a logger,
 * a database, a queue, or a tamper-evident store.
 *
 * Provided as `stores.audit` on the module options. Optional; if absent,
 * no events are emitted and no overhead is incurred.
 */
export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}
