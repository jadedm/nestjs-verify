import { PhoneIndexStore } from '../interfaces/phone-index-store.interface.js';

interface Entry {
  sid: string;
  expiresAt: number;
}

/**
 * In-memory phone -> sid index. Single-process only.
 */
export class MemoryPhoneIndexStore implements PhoneIndexStore {
  private readonly entries = new Map<string, Entry>();

  async set(phone: string, sid: string, ttlSeconds: number): Promise<void> {
    this.entries.set(phone, { sid, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async get(phone: string): Promise<string | null> {
    const entry = this.entries.get(phone);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(phone);
      return null;
    }
    return entry.sid;
  }

  async delete(phone: string): Promise<void> {
    this.entries.delete(phone);
  }
}
