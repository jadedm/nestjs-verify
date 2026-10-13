import type { PhoneIndexStore } from '@jadedm/nestjs-verify';
import type { RedisLike } from './redis-like.interface.js';

// The value is `sid|createdAtMs` (#82), or a plain sid when written before
// 0.9.0 or without createdAt. One key per recipient keeps every script on one
// cluster slot.

// Writes ARGV[1] (sid) for ARGV[2] seconds. With ARGV[3] (createdAt ms), it
// is refused while the key holds a later createdAt; an expired key is gone.
const SET_IF_NOT_NEWER_SCRIPT = `
if ARGV[3] == '' then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  return 1
end
local current = redis.call('GET', KEYS[1])
if current then
  local sep = string.find(current, '|', 1, true)
  local currentAt = sep and tonumber(string.sub(current, sep + 1))
  if currentAt and currentAt > tonumber(ARGV[3]) then
    return 0
  end
end
redis.call('SET', KEYS[1], ARGV[1] .. '|' .. ARGV[3], 'EX', ARGV[2])
return 1
`;

// Deletes the key only while it still holds ARGV[1], in either form.
const DELETE_IF_MATCHES_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current == ARGV[1] or (current and string.sub(current, 1, #ARGV[1] + 1) == ARGV[1] .. '|') then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const sidOf = (value: string | null): string | null => (value === null ? null : value.split('|')[0]);

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

  async set(phone: string, sid: string, ttlSeconds: number, createdAt?: Date): Promise<void> {
    const createdAtMs = createdAt ? String(createdAt.getTime()) : '';
    await this.client.eval(SET_IF_NOT_NEWER_SCRIPT, 1, this.prefix + phone, sid, String(ttlSeconds), createdAtMs);
  }

  async get(phone: string): Promise<string | null> {
    return sidOf(await this.client.get(this.prefix + phone));
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
