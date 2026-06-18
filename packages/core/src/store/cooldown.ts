import { Cache } from 'cache-manager';

/**
 * Phone-level cooldown after a successful send, to prevent SMS bombing.
 * Backed by cache-manager TTL.
 */
export class CooldownTracker {
  constructor(private readonly cache: Cache) {}

  private key(phone: string): string {
    return `verify:cooldown:${phone}`;
  }

  async isOnCooldown(phone: string): Promise<boolean> {
    // cache-manager v5 returns undefined for missing keys; v6 (Keyv-backed)
    // returns null. Treat both as "not on cooldown".
    const v = await this.cache.get(this.key(phone));
    return v !== undefined && v !== null;
  }

  async start(phone: string, seconds: number): Promise<void> {
    await this.cache.set(this.key(phone), 1, seconds * 1000);
  }
}
