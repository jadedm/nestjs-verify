import type {
  SmsProvider,
  SmsSendParams,
  SmsSendResult,
} from '@jadedm/nestjs-verify';
import type { Twilio } from 'twilio';
// twilio is CommonJS without an __esModule flag, so Node's ESM loader exposes
// only its default export. A named `import { Twilio }` loads under vitest and in
// the CommonJS build but fails for ESM consumers (#21).
import twilio from 'twilio';

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
    this.client = new twilio.Twilio(opts.accountSid, opts.authToken);
    this.from = opts.from;
    this.maxRetries = opts.maxRetries ?? 2;
    this.retryBaseMs = opts.retryBaseMs ?? 250;
  }

  /**
   * Retries transient failures with backoff. When `options.signal` aborts, no
   * further attempt starts and the backoff wait ends; a request already sent
   * to Twilio cannot be cancelled.
   */
  // The options type is written out rather than imported, so these
  // declarations still type-check against a core version that lacks it.
  async send(params: SmsSendParams, options?: { signal?: AbortSignal }): Promise<SmsSendResult> {
    const signal = options?.signal;
    const useMessagingService = this.from.startsWith('MG');
    let attempt = 0;
    let lastErr: unknown;
    while (attempt <= this.maxRetries) {
      signal?.throwIfAborted();
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
        await this.sleep(this.retryBaseMs * 2 ** attempt, signal);
        attempt++;
      }
    }
    throw lastErr;
  }

  /** Waits `ms`, or rejects with the abort reason as soon as `signal` aborts. */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
