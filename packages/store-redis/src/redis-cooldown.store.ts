import type { CooldownStore } from '@jadedm/nestjs-verify';
import type { RedisLike } from './redis-like.interface.js';

export interface RedisCooldownStoreOptions {
  client: RedisLike;
  /** Key prefix. Default 'verify:cd:'. */
  keyPrefix?: string;
}

export class RedisCooldownStore implements CooldownStore {
  private readonly client: RedisLike;
  private readonly prefix: string;

  constructor(opts: RedisCooldownStoreOptions) {
    this.client = opts.client;
    this.prefix = opts.keyPrefix ?? 'verify:cd:';
  }

  async remaining(key: string): Promise<number> {
    const ms = await this.client.pttl(this.prefix + key);
    return ms < 0 ? 0 : ms;
  }

  async start(key: string, seconds: number): Promise<void> {
    await this.client.set(this.prefix + key, '1', 'EX', seconds);
  }
}
