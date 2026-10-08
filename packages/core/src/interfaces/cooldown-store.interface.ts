export interface CooldownStore {
  /**
   * Returns milliseconds remaining on cooldown for `key`, or 0 if not on
   * cooldown. Used by the service to return a precise "wait N seconds"
   * value to the caller.
   */
  remaining(key: string): Promise<number>;
  /**
   * Start (or extend) cooldown for `seconds`. Idempotent. Clears any holder
   * recorded by `claim`, so a later `release` cannot end this cooldown.
   */
  start(key: string, seconds: number): Promise<void>;
  /**
   * Takes the cooldown for `seconds` on behalf of `holder` when it is free,
   * expired, or already held by the same `holder` (which renews it), and
   * returns 0. Otherwise returns the milliseconds left, at least 1; that
   * figure is advisory and may be read separately from the decision.
   *
   * Deciding who holds the key must be a single atomic operation in the
   * backing store, so that of any number of simultaneous claims for one key
   * exactly one returns 0 (#13).
   */
  claim(key: string, seconds: number, holder: string): Promise<number>;
  /**
   * Ends the cooldown only if it is still held by `holder`. Does nothing when
   * another holder has taken it, when it expired, or after `start`.
   */
  release(key: string, holder: string): Promise<void>;
}
