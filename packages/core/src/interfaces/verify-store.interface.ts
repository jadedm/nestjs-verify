export type VerificationStatus =
  | 'pending'
  | 'approved'
  | 'canceled'
  | 'expired';

export type VerificationChannel = 'sms' | 'voice' | 'email' | 'whatsapp';

export interface VerificationRecord {
  sid: string;
  phone: string;
  channel: VerificationChannel;
  codeHash: string;
  salt: string;
  attempts: number;
  maxAttempts: number;
  status: VerificationStatus;
  createdAt: Date;
  expiresAt: Date;
}

/** @deprecated The service no longer uses it; see `ReserveResult`. */
export interface IncrementResult {
  record: VerificationRecord | null;
  outcome: 'incremented' | 'locked-out' | 'not-pending' | 'not-found';
}

export interface ReserveResult {
  /** The record after the reservation, or as it stands when none was made. */
  record: VerificationRecord | null;
  /**
   * `reserved`: attempts was below maxAttempts on a pending, unexpired
   * record and has been incremented; this caller may compare one code.
   * `exhausted`: the record is pending but every attempt is spent (possibly
   * by checks still in flight). `expired`: pending but past expiresAt.
   * `not-pending`: approved, canceled or expired. `not-found`: no such sid.
   */
  outcome: 'reserved' | 'exhausted' | 'expired' | 'not-pending' | 'not-found';
}

/**
 * Durable store for verification records. Adapters (Postgres, Mongo, ...)
 * implement this. `reserveAttempt` must be atomic so concurrent checks cannot
 * compare more codes than maxAttempts allows.
 */
export interface VerifyStore {
  create(v: VerificationRecord): Promise<void>;
  get(sid: string): Promise<VerificationRecord | null>;
  /**
   * In one atomic operation: if the record is pending, not past expiresAt,
   * and attempts is below maxAttempts, increment attempts and return
   * `reserved` with the updated
   * record. It never changes the status; the caller cancels the record when a
   * wrong code spends the last attempt. The service reserves before it
   * compares the code, so of any number of simultaneous checks at most
   * maxAttempts get to compare one.
   */
  reserveAttempt(sid: string): Promise<ReserveResult>;
  /**
   * Transition out of 'pending'. Returns true if the transition happened,
   * false if the record was no longer pending (race with another caller).
   */
  markStatus(
    sid: string,
    status: Exclude<VerificationStatus, 'pending'>,
  ): Promise<boolean>;
  delete(sid: string): Promise<void>;
}
