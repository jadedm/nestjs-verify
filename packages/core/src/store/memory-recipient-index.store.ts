import { RecipientIndexStore } from '../interfaces/recipient-index-store.interface.js';

interface Entry {
  sid: string;
  expiresAt: number;
}

/**
 * In-memory recipient -> sid index. Single-process only.
 */
export class MemoryRecipientIndexStore implements RecipientIndexStore {
  private readonly entries = new Map<string, Entry>();

  async set(recipient: string, sid: string, ttlSeconds: number): Promise<void> {
    this.entries.set(recipient, { sid, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async get(recipient: string): Promise<string | null> {
    const entry = this.entries.get(recipient);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(recipient);
      return null;
    }
    return entry.sid;
  }

  async delete(recipient: string): Promise<void> {
    this.entries.delete(recipient);
  }

  async deleteIfMatches(recipient: string, sid: string): Promise<void> {
    if (this.entries.get(recipient)?.sid !== sid) return;
    this.entries.delete(recipient);
  }
}

/** @deprecated Renamed to `MemoryRecipientIndexStore` in 0.9.0; removed in 1.0. */
export const MemoryPhoneIndexStore = MemoryRecipientIndexStore;
/** @deprecated Renamed to `MemoryRecipientIndexStore` in 0.9.0; removed in 1.0. */
export type MemoryPhoneIndexStore = MemoryRecipientIndexStore;
