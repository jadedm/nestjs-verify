/**
 * Maps a recipient (the store key: an E.164 phone or a lowercased email) to
 * the sid of its active verification.
 */
export interface RecipientIndexStore {
  /**
   * Index a recipient -> sid mapping with a TTL (one active verification per
   * recipient). With `createdAt` (the record's), the write is refused while a
   * live entry for the recipient carries a later `createdAt`, in one atomic
   * operation, so a start whose write stalled cannot replace a newer start's
   * entry (#82). An expired entry, an entry with no `createdAt`, or a call
   * without one is overwritten. Equal `createdAt` overwrites.
   */
  set(recipient: string, sid: string, ttlSeconds: number, createdAt?: Date): Promise<void>;
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
