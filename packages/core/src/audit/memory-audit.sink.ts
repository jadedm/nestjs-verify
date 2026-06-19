import {
  AuditEvent,
  AuditSink,
} from '../interfaces/audit-sink.interface.js';

/**
 * In-memory audit sink. Holds events in an array for inspection. Useful
 * for tests and dev. Not safe across process restart; do not use in prod.
 */
export class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  /** Convenience for tests. */
  clear(): void {
    this.events.length = 0;
  }
}
