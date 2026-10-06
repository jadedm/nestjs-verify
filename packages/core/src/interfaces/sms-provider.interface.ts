export interface SmsSendParams {
  to: string;
  body: string;
}

export interface SmsSendResult {
  providerMessageId: string;
  provider: string;
}

/** Passed by the core on every send. Providers may ignore it. */
export interface ProviderSendOptions {
  /**
   * Aborted when the core stops waiting for this attempt (`delivery`
   * timeouts). A provider that honours it should cancel its request and stop
   * retrying; the core moves on whether or not it does.
   */
  signal?: AbortSignal;
}

export interface SmsProvider {
  /** Stable identifier — e.g. 'twilio', 'messagebird'. Used in logs/audit. */
  readonly name: string;
  send(params: SmsSendParams, options?: ProviderSendOptions): Promise<SmsSendResult>;
}
