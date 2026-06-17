export interface SendAttempt {
  sid: string;
  phone: string;
  ip?: string;
  channel: string;
  provider: string;
  success: boolean;
  errorCode?: string;
  ts?: Date;
}

export interface AbuseStore {
  recordSendAttempt(s: SendAttempt): Promise<void>;
  countAttemptsByIp(ip: string, windowMs: number): Promise<number>;
  countAttemptsByPhone(phone: string, windowMs: number): Promise<number>;
  countDistinctPhonesByIp(ip: string, windowMs: number): Promise<number>;
}
