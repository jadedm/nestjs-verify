export interface RateLimitHit {
  /** Counter value after this hit. */
  count: number;
  /** Configured ceiling for this window. */
  limit: number;
  /** Convenience flag: count > limit. */
  exceeded: boolean;
  /** Unix milliseconds at which the current window resets. */
  resetAt: number;
}

/**
 * Fixed-window rate limit counter, keyed by an arbitrary string.
 *
 * Implementations MUST be atomic. Two concurrent calls to `hit` for the
 * same key must not race past the counter's intended ceiling. For shared
 * backends (Postgres, Mongo, Redis), this means using a single round-trip
 * atomic operation. For in-memory implementations, a mutex per key is
 * sufficient because Node's event loop is single-threaded.
 */
export interface RateLimitStore {
  hit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitHit>;
}
