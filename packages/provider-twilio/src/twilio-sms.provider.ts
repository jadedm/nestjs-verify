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
  /**
   * Retry an attempt that may have been accepted (HTTP 500, 502 or 504, a
   * response broken after its headers, or any network error other than a
   * refused connection, a DNS failure or an unreachable host or network).
   * Default true: better odds of delivery, but a retry can deliver the same
   * code a second time. With false, such a failure is thrown at once, marked
   * mayHaveSent, and the user's retry waits for the cooldown. Failures known
   * not to have sent (429, 503, refused connection, DNS) are retried either way.
   * The core may still try the next provider in `fallbacks` (#51).
   */
  retryAfterUncertain?: boolean;
}

/**
 * Errors Twilio considers transient — worth retrying. Everything else
 * (invalid number, blocked recipient, geo-permission) is terminal.
 */
const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/**
 * Failures after which Twilio may already have accepted the message. 429 and
 * 503 are refusals; a 500, 502 or 504 can come after the message was queued.
 * A network error with no HTTP status may have left after the request was
 * written, unless the connection was never made.
 */
const UNCERTAIN_STATUS_CODES = new Set([500, 502, 504]);
const NEVER_CONNECTED = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);

const mayHaveBeenAccepted = (err: unknown): boolean => {
  const { status, code } = (err ?? {}) as { status?: unknown; code?: unknown };
  // axios 1.7.5+ reports a response that broke after its headers as
  // ERR_BAD_RESPONSE with that response's status, often 200: Twilio may have
  // queued the message.
  if (code === 'ERR_BAD_RESPONSE') return true;
  if (typeof status === 'number') return UNCERTAIN_STATUS_CODES.has(status);
  return !(typeof code === 'string' && NEVER_CONNECTED.has(code));
};

/**
 * Marks the error the way the core reads it (`mayHaveSent: true`), when any
 * attempt was uncertain. An error that cannot take a new property (frozen)
 * is wrapped, keeping its message, name, status and code, with the original
 * as `cause`, so the mark and the core's cooldown are never lost.
 */
const markIfUncertain = (err: unknown, uncertain: boolean): unknown => {
  if (!uncertain || typeof err !== 'object' || err === null) return err;
  if (Object.isExtensible(err)) return Object.assign(err, { mayHaveSent: true });
  const { message, name, status, code } = err as { message?: unknown; name?: unknown; status?: unknown; code?: unknown };
  const wrapped = new Error(typeof message === 'string' ? message : String(err), { cause: err });
  if (typeof name === 'string') wrapped.name = name;
  return Object.assign(wrapped, { status, code, mayHaveSent: true });
};

export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';
  private readonly client: Twilio;
  private readonly from: string;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly retryAfterUncertain: boolean;

  constructor(opts: TwilioSmsProviderOptions) {
    this.client = new twilio.Twilio(opts.accountSid, opts.authToken);
    this.from = opts.from;
    this.maxRetries = opts.maxRetries ?? 2;
    this.retryBaseMs = opts.retryBaseMs ?? 250;
    this.retryAfterUncertain = opts.retryAfterUncertain ?? true;
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
    // Once any attempt may have been accepted, the final error says so, even
    // if a later attempt failed cleanly.
    let uncertain = false;
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
        const attemptUncertain = mayHaveBeenAccepted(err);
        uncertain = uncertain || attemptUncertain;
        const status = (err as { status?: number } | null)?.status;
        if (status && !TRANSIENT_STATUS_CODES.has(status)) throw markIfUncertain(err, uncertain);
        if (attemptUncertain && !this.retryAfterUncertain) break;
        if (attempt === this.maxRetries) break;
        await this.sleep(this.retryBaseMs * 2 ** attempt, signal);
        attempt++;
      }
    }
    throw markIfUncertain(lastErr, uncertain);
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
