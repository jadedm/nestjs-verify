export interface EmailSendParams {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSendResult {
  providerMessageId: string;
  provider: string;
}

export interface EmailProvider {
  /** Stable identifier, e.g. 'ses'. Used in logs, audit and metrics. */
  readonly name: string;
  send(params: EmailSendParams): Promise<EmailSendResult>;
}
