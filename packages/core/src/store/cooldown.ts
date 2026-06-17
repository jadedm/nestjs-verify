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
    return (await this.cache.get(this.key(phone))) !== undefined;
  }

  async start(phone: string, seconds: number): Promise<void> {
    await this.cache.set(this.key(phone), 1, seconds * 1000);
  }
}
