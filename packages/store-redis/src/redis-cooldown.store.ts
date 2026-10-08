import type { CooldownStore } from '@jadedm/nestjs-verify';
import type { RedisLike } from './redis-like.interface.js';

// Takes the key for ARGV[1] when it is free or already held by ARGV[1], for
// ARGV[2] ms, and returns 0; otherwise returns the ms left (at least 1). One
// script, so the check and the write cannot interleave with another claim.
// `start` stores "1", which no sid equals, so a claim never matches it.
const CLAIM_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if (not v) or v == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 0
end
local t = redis.call('PTTL', KEYS[1])
if t < 1 then return 1 end
return t
`;

// Deletes the key only while it still holds ARGV[1].
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

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

  async claim(key: string, seconds: number, holder: string): Promise<number> {
    const ms = await this.client.eval(CLAIM_SCRIPT, 1, this.prefix + key, holder, String(seconds * 1000));
    return Number(ms);
  }

  async release(key: string, holder: string): Promise<void> {
    await this.client.eval(RELEASE_SCRIPT, 1, this.prefix + key, holder);
  }
}
