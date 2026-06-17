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

  async countAttemptsByPhone(
    phone: string,
    windowMs: number,
  ): Promise<number> {
    const cutoff = Date.now() - windowMs;
    return this.log.filter((a) => a.phone === phone && a.ts.getTime() > cutoff)
      .length;
  }

  async countDistinctPhonesByIp(
    ip: string,
    windowMs: number,
  ): Promise<number> {
    const cutoff = Date.now() - windowMs;
    const phones = new Set(
      this.log
        .filter((a) => a.ip === ip && a.ts.getTime() > cutoff)
        .map((a) => a.phone),
    );
    return phones.size;
  }
}
