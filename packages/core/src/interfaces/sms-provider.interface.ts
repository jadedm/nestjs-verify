export interface SmsSendParams {
  to: string;
  body: string;
}

export interface SmsSendResult {
  providerMessageId: string;
  provider: string;
}

export interface SmsProvider {
  /** Stable identifier — e.g. 'twilio', 'messagebird'. Used in logs/audit. */
  readonly name: string;
  send(params: SmsSendParams): Promise<SmsSendResult>;
}
