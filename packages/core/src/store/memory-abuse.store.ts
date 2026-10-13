import {
  AbuseStore,
  SendAttempt,
} from '../interfaces/abuse-store.interface.js';

// A record written by core before 0.9.0 carries only `phone` (#8).
const recipientOf = (a: SendAttempt): string | undefined => a.recipient ?? a.phone;

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
    return this.log.filter((a) => recipientOf(a) === recipient && a.ts.getTime() > cutoff)
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
        .map(recipientOf),
    );
    return recipients.size;
  }

  /** @deprecated Renamed to `countAttemptsByRecipient` in 0.9.0; removed in 1.0. */
  async countAttemptsByPhone(phone: string, windowMs: number): Promise<number> {
    return this.countAttemptsByRecipient(phone, windowMs);
  }

  /** @deprecated Renamed to `countDistinctRecipientsByIp` in 0.9.0; removed in 1.0. */
  async countDistinctPhonesByIp(ip: string, windowMs: number): Promise<number> {
    return this.countDistinctRecipientsByIp(ip, windowMs);
  }
}
