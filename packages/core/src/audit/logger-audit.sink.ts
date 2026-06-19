import { Logger } from '@nestjs/common';
import {
  AuditEvent,
  AuditSink,
} from '../interfaces/audit-sink.interface.js';

/**
 * Writes audit events through Nest's Logger, which picks up whatever
 * underlying logger the host application has configured (pino, winston,
 * the default Console logger, etc.).
 *
 * Use this when you want audit events to appear in the same log stream
 * as the rest of your application's logs.
 */
export class LoggerAuditSink implements AuditSink {
  private readonly log: Logger;

  constructor(loggerName = 'VerifyAudit') {
    this.log = new Logger(loggerName);
  }

  async record(event: AuditEvent): Promise<void> {
    const payload = {
      type: event.type,
      sid: event.sid,
      phone: event.phoneRedacted,
      ip: event.ip,
      channel: event.channel,
      provider: event.provider,
      outcome: event.outcome,
      meta: event.meta,
    };
    this.log.log(`audit: ${event.type}`, JSON.stringify(payload));
  }
}
