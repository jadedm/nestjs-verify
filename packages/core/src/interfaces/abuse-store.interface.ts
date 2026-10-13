export interface SendAttempt {
  sid: string;
  /** The recipient's store key: an E.164 phone or a lowercased email. */
  recipient: string;
  ip?: string;
  channel: string;
  provider: string;
  success: boolean;
  errorCode?: string;
  ts?: Date;
}

/**
 * What core calls. The shipped stores also offer `countAttemptsByIp` and
 * `countAttemptsByRecipient` for host code; core does not need them, so the
 * interface does not require them.
 */
export interface AbuseStore {
  recordSendAttempt(s: SendAttempt): Promise<void>;
  countDistinctRecipientsByIp(ip: string, windowMs: number): Promise<number>;
}
