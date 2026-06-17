import type {
  SmsProvider,
  SmsSendParams,
  SmsSendResult,
} from '@jadedm/nestjs-verify';
import { Twilio } from 'twilio';

export interface TwilioSmsProviderOptions {
  accountSid: string;
  authToken: string;
  /** E.164 sender number, or Messaging Service SID (starts with MG…). */
  from: string;
  /** Retry budget for transient (5xx, network) failures. Default 2. */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff. Default 250. */
  retryBaseMs?: number;
}

/**
 * Errors Twilio considers transient — worth retrying. Everything else
 * (invalid number, blocked recipient, geo-permission) is terminal.
 */
const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';
  private readonly client: Twilio;
  private readonly from: string;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(opts: TwilioSmsProviderOptions) {
    this.client = new Twilio(opts.accountSid, opts.authToken);
    this.from = opts.from;
    this.maxRetries = opts.maxRetries ?? 2;
    this.retryBaseMs = opts.retryBaseMs ?? 250;
  }

  async send(params: SmsSendParams): Promise<SmsSendResult> {
    const useMessagingService = this.from.startsWith('MG');
    let attempt = 0;
    let lastErr: unknown;
    while (attempt <= this.maxRetries) {
      try {
        const message = await this.client.messages.create({
          to: params.to,
          body: params.body,
          ...(useMessagingService
            ? { messagingServiceSid: this.from }
            : { from: this.from }),
        });
        return { providerMessageId: message.sid, provider: this.name };
      } catch (err) {
        lastErr = err;
        const status = (err as { status?: number }).status;
        if (status && !TRANSIENT_STATUS_CODES.has(status)) throw err;
        if (attempt === this.maxRetries) break;
        await this.sleep(this.retryBaseMs * 2 ** attempt);
        attempt++;
      }
    }
    throw lastErr;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
