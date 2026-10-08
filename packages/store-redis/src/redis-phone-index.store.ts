import type { PhoneIndexStore } from '@jadedm/nestjs-verify';
import type { RedisLike } from './redis-like.interface.js';

// Deletes the key only while it still holds ARGV[1].
const DELETE_IF_MATCHES_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export interface RedisPhoneIndexStoreOptions {
  client: RedisLike;
  /** Key prefix. Default 'verify:idx:'. */
  keyPrefix?: string;
}

export class RedisPhoneIndexStore implements PhoneIndexStore {
  private readonly client: RedisLike;
  private readonly prefix: string;

  constructor(opts: RedisPhoneIndexStoreOptions) {
    this.client = opts.client;
    this.prefix = opts.keyPrefix ?? 'verify:idx:';
  }

  async set(phone: string, sid: string, ttlSeconds: number): Promise<void> {
    await this.client.set(this.prefix + phone, sid, 'EX', ttlSeconds);
  }

  async get(phone: string): Promise<string | null> {
    return this.client.get(this.prefix + phone);
  }

  async delete(phone: string): Promise<void> {
    await this.client.del(this.prefix + phone);
  }

  async deleteIfMatches(phone: string, sid: string): Promise<void> {
    await this.client.eval(DELETE_IF_MATCHES_SCRIPT, 1, this.prefix + phone, sid);
  }
}
