import { CooldownStore } from '../interfaces/cooldown-store.interface.js';

/**
 * In-memory cooldown tracker. Single-process only.
 */
export class MemoryCooldownStore implements CooldownStore {
  private readonly cooldowns = new Map<string, number>();

  async remaining(key: string): Promise<number> {
    const expiresAt = this.cooldowns.get(key);
    if (!expiresAt) return 0;
    const ms = expiresAt - Date.now();
    if (ms <= 0) {
      this.cooldowns.delete(key);
      return 0;
    }
    return ms;
  }

  async start(key: string, seconds: number): Promise<void> {
    this.cooldowns.set(key, Date.now() + seconds * 1000);
  }
}
