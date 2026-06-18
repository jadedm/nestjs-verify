/**
 * Minimal Redis client interface required by the verify Redis stores.
 *
 * Compatible with `ioredis` (primary peer dependency). Users on
 * `node-redis` or other clients can pass any object that matches this
 * shape, either by handing in their client directly (if compatible) or
 * by writing a small adapter.
 *
 * The interface is intentionally narrow: only the commands the stores
 * actually call.
 */
export interface RedisLike {
  /** Returns the value at `key`, or null if missing. */
  get(key: string): Promise<string | null>;

  /**
   * SET key value. Supports the variadic args forms used here:
   *   set(key, value, 'EX', seconds)
   *   set(key, value, 'PX', ms)
   *   set(key, value)
   */
  set(key: string, value: string, ...args: any[]): Promise<unknown>;

  /** Deletes a key. */
  del(key: string): Promise<unknown>;

  /** Remaining TTL in milliseconds. -2 if key missing, -1 if no TTL. */
  pttl(key: string): Promise<number>;

  /**
   * EVAL a Lua script.
   *   eval(script, keysCount, ...keysAndArgs)
   */
  eval(script: string, ...args: (string | number)[]): Promise<unknown>;
}
