export interface PhoneIndexStore {
  /**
   * Index a phone -> sid mapping with a TTL. Overwrites any prior mapping
   * for the same phone (you only have one active verification at a time).
   */
  set(phone: string, sid: string, ttlSeconds: number): Promise<void>;
  /** Returns the indexed sid for `phone`, or null if absent or expired. */
  get(phone: string): Promise<string | null>;
  /** Removes the index entry. Used when a verification reaches a terminal state. */
  delete(phone: string): Promise<void>;
}
