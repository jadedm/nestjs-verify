import {
  AbuseStore,
  SendAttempt,
} from '../interfaces/abuse-store.interface.js';

export class MemoryAbuseStore implements AbuseStore {
  private readonly log: Array<SendAttempt & { ts: Date }> = [];

  async recordSendAttempt(s: SendAttempt): Promise<void> {
    this.log.push({ ...s, ts: s.ts ?? new Date() });
  }

  async countAttemptsByIp(ip: string, windowMs: number): Promise<number> {
    const cutoff = Date.now() - windowMs;
    return this.log.filter((a) => a.ip === ip && a.ts.getTime() > cutoff)
      .length;
  }

  async countAttemptsByRecipient(
    recipient: string,
    windowMs: number,
  ): Promise<number> {
    const cutoff = Date.now() - windowMs;
    return this.log.filter((a) => a.recipient === recipient && a.ts.getTime() > cutoff)
      .length;
  }

  async countDistinctRecipientsByIp(
    ip: string,
    windowMs: number,
  ): Promise<number> {
    const cutoff = Date.now() - windowMs;
    const recipients = new Set(
      this.log
        .filter((a) => a.ip === ip && a.ts.getTime() > cutoff)
        .map((a) => a.recipient),
    );
    return recipients.size;
  }
}
