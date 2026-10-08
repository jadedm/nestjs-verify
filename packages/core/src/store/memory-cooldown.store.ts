import { CooldownStore } from '../interfaces/cooldown-store.interface.js';

interface Entry {
  expiresAt: number;
  /** Set by `claim`, cleared by `start`. */
  holder?: string;
}

/**
 * In-memory cooldown tracker. Single-process only. `claim` is atomic because
 * it reads and writes the map with no `await` in between.
 */
export class MemoryCooldownStore implements CooldownStore {
  private readonly cooldowns = new Map<string, Entry>();

  async remaining(key: string): Promise<number> {
    const entry = this.cooldowns.get(key);
    if (!entry) return 0;
    const ms = entry.expiresAt - Date.now();
    if (ms <= 0) {
      this.cooldowns.delete(key);
      return 0;
    }
    return ms;
  }

  async start(key: string, seconds: number): Promise<void> {
    this.cooldowns.set(key, { expiresAt: Date.now() + seconds * 1000 });
  }

  async claim(key: string, seconds: number, holder: string): Promise<number> {
    const now = Date.now();
    const entry = this.cooldowns.get(key);
    const taken = entry !== undefined && entry.expiresAt > now && entry.holder !== holder;
    if (taken) return Math.max(1, entry.expiresAt - now);
    this.cooldowns.set(key, { expiresAt: now + seconds * 1000, holder });
    return 0;
  }

  async release(key: string, holder: string): Promise<void> {
    if (this.cooldowns.get(key)?.holder !== holder) return;
    this.cooldowns.delete(key);
  }
}
