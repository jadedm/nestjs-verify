/**
 * Maps a recipient (the store key: an E.164 phone or a lowercased email) to
 * the sid of its active verification.
 */
export interface RecipientIndexStore {
  /**
   * Index a recipient -> sid mapping with a TTL. Overwrites any prior mapping
   * for the same recipient (one active verification at a time).
   */
  set(recipient: string, sid: string, ttlSeconds: number): Promise<void>;
  /** Returns the indexed sid for `recipient`, or null if absent or expired. */
  get(recipient: string): Promise<string | null>;
  /** Removes the index entry, whatever it holds. */
  delete(recipient: string): Promise<void>;
  /**
   * Removes the entry only while it maps `recipient` to `sid`, in one atomic
   * operation. The service uses it whenever it cleans up after one
   * verification, so it cannot remove the entry of a newer one (#9).
   */
  deleteIfMatches(recipient: string, sid: string): Promise<void>;
}
