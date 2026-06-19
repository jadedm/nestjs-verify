import {
  AuditEvent,
  AuditSink,
} from '../interfaces/audit-sink.interface.js';

/**
 * Emits one JSON line per event to stdout (or a supplied writer). Useful
 * when the host application already ships stdout to a log pipeline
 * (Loki, CloudWatch, Datadog, etc.) and you want audit events in the
 * same stream.
 *
 * Not tamper-evident. For compliance environments, use a durable sink
 * (PostgresAuditSink, MongoAuditSink) or chain into a tamper-evident
 * store yourself.
 */
export class StdoutAuditSink implements AuditSink {
  constructor(
    private readonly write: (line: string) => void = (l) => process.stdout.write(l + '\n'),
  ) {}

  async record(event: AuditEvent): Promise<void> {
    this.write(JSON.stringify({ ...event, ts: event.ts.toISOString() }));
  }
}
