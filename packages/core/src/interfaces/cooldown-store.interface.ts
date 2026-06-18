export interface CooldownStore {
  /**
   * Returns milliseconds remaining on cooldown for `key`, or 0 if not on
   * cooldown. Used by the service to return a precise "wait N seconds"
   * value to the caller.
   */
  remaining(key: string): Promise<number>;
  /** Start (or extend) cooldown for `seconds`. Idempotent. */
  start(key: string, seconds: number): Promise<void>;
}
