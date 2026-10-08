export interface PhoneIndexStore {
  /**
   * Index a phone -> sid mapping with a TTL. Overwrites any prior mapping
   * for the same phone (you only have one active verification at a time).
   */
  set(phone: string, sid: string, ttlSeconds: number): Promise<void>;
  /** Returns the indexed sid for `phone`, or null if absent or expired. */
  get(phone: string): Promise<string | null>;
  /** Removes the index entry, whatever it holds. */
  delete(phone: string): Promise<void>;
  /**
   * Removes the entry only while it maps `phone` to `sid`, in one atomic
   * operation. The service uses it whenever it cleans up after one
   * verification, so it cannot remove the entry of a newer one (#9).
   */
  deleteIfMatches(phone: string, sid: string): Promise<void>;
}
