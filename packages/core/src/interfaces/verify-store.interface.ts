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

export interface IncrementResult {
  record: VerificationRecord | null;
  outcome: 'incremented' | 'locked-out' | 'not-pending' | 'not-found';
}

/**
 * Durable store for verification records. Adapters (Postgres, Mongo, ...)
 * implement this. The contract requires atomicity on incrementAttempts so
 * concurrent checks cannot over-spend the attempt budget.
 */
export interface VerifyStore {
  create(v: VerificationRecord): Promise<void>;
  get(sid: string): Promise<VerificationRecord | null>;
  /**
   * Atomic: increment attempts AND if it reaches maxAttempts, flip status to
   * 'canceled'. Returns the post-update record so callers avoid a second
   * round-trip.
   */
  incrementAttempts(sid: string): Promise<IncrementResult>;
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
