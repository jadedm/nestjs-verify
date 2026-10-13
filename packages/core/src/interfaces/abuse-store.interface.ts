export interface SendAttempt {
  sid: string;
  /** The recipient's store key: an E.164 phone or a lowercased email. */
  recipient: string;
  /**
   * @deprecated Same value as `recipient`, for stores written before 0.9.0
   * (#8). Core sets both; removed in 1.0.
   */
  phone?: string;
  ip?: string;
  channel: string;
  provider: string;
  success: boolean;
  errorCode?: string;
  ts?: Date;
}

/**
 * Before 0.9.0 the recipient methods were named for phones (#8). A store
 * implements the new name, the old one, or both; core calls the new name
 * when present. From 1.0 the new names are required and the old ones go.
 */
export interface AbuseStore {
  recordSendAttempt(s: SendAttempt): Promise<void>;
  countAttemptsByIp(ip: string, windowMs: number): Promise<number>;
  countAttemptsByRecipient?(recipient: string, windowMs: number): Promise<number>;
  countDistinctRecipientsByIp?(ip: string, windowMs: number): Promise<number>;
  /** @deprecated Renamed to `countAttemptsByRecipient` in 0.9.0; removed in 1.0. */
  countAttemptsByPhone?(phone: string, windowMs: number): Promise<number>;
  /** @deprecated Renamed to `countDistinctRecipientsByIp` in 0.9.0; removed in 1.0. */
  countDistinctPhonesByIp?(ip: string, windowMs: number): Promise<number>;
}
