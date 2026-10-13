import type { PhoneIndexStore } from '@jadedm/nestjs-verify';
import type { RedisLike } from './redis-like.interface.js';

// Deletes the key only while it still holds ARGV[1].
const DELETE_IF_MATCHES_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export interface RedisRecipientIndexStoreOptions {
  client: RedisLike;
  /** Key prefix. Default 'verify:idx:'. */
  keyPrefix?: string;
}

// Implements the pre-0.9.0 type name: the core range this adapter supports
// starts before `RecipientIndexStore` existed (#8).
export class RedisRecipientIndexStore implements PhoneIndexStore {
  private readonly client: RedisLike;
  private readonly prefix: string;

  constructor(opts: RedisRecipientIndexStoreOptions) {
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

/** @deprecated Renamed to `RedisRecipientIndexStore` in 0.9.0 (#8); removed in 1.0. */
export const RedisPhoneIndexStore = RedisRecipientIndexStore;
/** @deprecated Renamed to `RedisRecipientIndexStore` in 0.9.0 (#8); removed in 1.0. */
export type RedisPhoneIndexStore = RedisRecipientIndexStore;
/** @deprecated Renamed to `RedisRecipientIndexStoreOptions` in 0.9.0 (#8); removed in 1.0. */
export type RedisPhoneIndexStoreOptions = RedisRecipientIndexStoreOptions;
