import {
  asyncHandler,
  type SmsProvider,
  type SmsSendParams,
  type SmsSendResult,
} from '@jadedm/nestjs-verify';

/**
 * Auth options for Gupshup. Discriminated by `mode`.
 */
export type GupshupAuth =
  | { mode: 'userpass'; userid: string; password: string }
  | { mode: 'apikey'; apiKey: string };

export interface GupshupSmsProviderOptions {
  auth: GupshupAuth;
  /** Approved DLT sender id or short code. */
  sender: string;
  /** Optional endpoint override. Defaults to the enterprise endpoint. */
  endpoint?: string;
  /** Retry budget for transient (5xx, network) failures. Default 2. */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff. Default 250. */
  retryBaseMs?: number;
  /** Override the fetch implementation (useful for tests). */
  fetchImpl?: typeof fetch;
}

const DEFAULT_ENDPOINT = 'https://media.smsgupshup.com/GatewayAPI/rest';

/**
 * Mapper from auth mode to the URL query params it contributes. Replaces
 * what would otherwise be an if/else tree at the call site.
 */
const AUTH_MAPPERS: Record<
  GupshupAuth['mode'],
  (auth: GupshupAuth) => Record<string, string>
> = {
  userpass: (a) => {
    const u = a as Extract<GupshupAuth, { mode: 'userpass' }>;
    return { userid: u.userid, password: u.password };
  },
  apikey: (a) => {
    const k = a as Extract<GupshupAuth, { mode: 'apikey' }>;
    return { apikey: k.apiKey };
  },
};

/**
 * Outcome classifier. Every response from Gupshup falls into one of three
 * buckets: ok (with the provider message id), terminal (caller-visible
 * failure), or transient (retry).
 */
type Outcome =
  | { kind: 'ok'; providerMessageId: string }
  | { kind: 'terminal'; message: string }
  | { kind: 'transient'; message: string };

const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/**
 * Failures after which Gupshup may already have accepted the message: a 500,
 * 502 or 504; a body that could not be read after a response arrived; a
 * network error after connecting. 429 and 503 are refusals, and a refused
 * connection or failed DNS lookup never reached Gupshup.
 */
const UNCERTAIN_STATUS_CODES = new Set([500, 502, 504]);
// A connect timeout (UND_ERR_CONNECT_TIMEOUT from undici) never finished the
// handshake, so the request cannot have reached Gupshup.
const NEVER_CONNECTED = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

// fetch (undici) puts the system error code on `cause`.
const errorCode = (err: Error): unknown =>
  (err as { cause?: { code?: unknown } }).cause?.code ?? (err as { code?: unknown }).code;

const attemptMayHaveSent = (fetchError: Error | null, bodyError: Error | null, status: number): boolean => {
  if (fetchError) {
    const code = errorCode(fetchError);
    return !(typeof code === 'string' && NEVER_CONNECTED.has(code));
  }
  if (bodyError) return true;
  return UNCERTAIN_STATUS_CODES.has(status);
};

/** Marks the error the way the core reads it (`mayHaveSent: true`), when any attempt was uncertain. */
const markIfUncertain = <E extends Error>(err: E, uncertain: boolean): E =>
  uncertain && Object.isExtensible(err) ? Object.assign(err, { mayHaveSent: true }) : err;

function classify(
  fetchError: Error | null,
  status: number,
  body: string,
): Outcome {
  if (fetchError) {
    return { kind: 'transient', message: `network: ${fetchError.message}` };
  }
  if (TRANSIENT_STATUS_CODES.has(status)) {
    return { kind: 'transient', message: `HTTP ${status}` };
  }
  if (status >= 400) {
    return { kind: 'terminal', message: `HTTP ${status}: ${body.slice(0, 200)}` };
  }
  const parsed = parseGupshupResponse(body);
  if (!parsed.ok) {
    return { kind: 'terminal', message: `provider error: ${parsed.detail}` };
  }
  return { kind: 'ok', providerMessageId: parsed.detail };
}

export class GupshupSmsProvider implements SmsProvider {
  readonly name = 'gupshup';
  private readonly opts: Required<
    Omit<GupshupSmsProviderOptions, 'fetchImpl' | 'auth' | 'sender'>
  > & {
    auth: GupshupAuth;
    sender: string;
    fetchImpl: typeof fetch;
  };

  constructor(opts: GupshupSmsProviderOptions) {
    this.opts = {
      auth: opts.auth,
      sender: opts.sender,
      endpoint: opts.endpoint ?? DEFAULT_ENDPOINT,
      maxRetries: opts.maxRetries ?? 2,
      retryBaseMs: opts.retryBaseMs ?? 250,
      fetchImpl: opts.fetchImpl ?? fetch,
    };
  }

  /**
   * Retries transient failures with backoff. `options.signal` is passed to
   * fetch; once it aborts, no further attempt starts and the backoff wait ends.
   * The options type is written out rather than imported, so these
   * declarations still type-check against a core version that lacks it.
   */
  async send(params: SmsSendParams, options?: { signal?: AbortSignal }): Promise<SmsSendResult> {
    const signal = options?.signal;
    let attempt = 0;
    let lastTransient: string | null = null;
    // Once any attempt may have been accepted, the final error says so.
    let uncertain = false;
    while (attempt <= this.opts.maxRetries) {
      signal?.throwIfAborted();
      const url = this.buildUrl(params);
      const [res, fetchErr] = await asyncHandler(
        this.opts.fetchImpl(url, { method: 'GET', signal }),
      );
      const status = res?.status ?? 0;
      const [body, bodyErr] = res
        ? await asyncHandler(res.text())
        : [null as string | null, null];
      const outcome = classify(
        fetchErr ?? bodyErr,
        status,
        body ?? '',
      );
      uncertain = uncertain || (outcome.kind !== 'ok' && attemptMayHaveSent(fetchErr, bodyErr, status));

      if (outcome.kind === 'ok') {
        return {
          providerMessageId: outcome.providerMessageId,
          provider: this.name,
        };
      }
      if (outcome.kind === 'terminal') {
        throw markIfUncertain(new GupshupTerminalError(outcome.message, status), uncertain);
      }
      // transient
      lastTransient = outcome.message;
      if (attempt === this.opts.maxRetries) break;
      await this.sleep(this.opts.retryBaseMs * 2 ** attempt, signal);
      attempt++;
    }
    throw markIfUncertain(
      new GupshupTransientError(`Gupshup retry budget exhausted: ${lastTransient}`),
      uncertain,
    );
  }

  private buildUrl(params: SmsSendParams): string {
    const u = new URL(this.opts.endpoint);
    const fixed: Record<string, string> = {
      method: 'sendMessage',
      format: 'text',
      v: '1.1',
      msg_type: 'text',
      send_to: params.to.replace(/^\+/, ''),
      msg: params.body,
      mask: this.opts.sender,
    };
    const authParams = AUTH_MAPPERS[this.opts.auth.mode](this.opts.auth);
    for (const [k, v] of Object.entries({ ...fixed, ...authParams })) {
      u.searchParams.set(k, v);
    }
    return u.toString();
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

export class GupshupTransientError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'GupshupTransientError';
  }
}

export class GupshupTerminalError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'GupshupTerminalError';
  }
}

interface GupshupResponse {
  ok: boolean;
  status: string;
  detail: string;
}

export function parseGupshupResponse(body: string): GupshupResponse {
  const parts = body.trim().split('|').map((p) => p.trim());
  return {
    ok: parts[0]?.toLowerCase() === 'success',
    status: parts[0] ?? '',
    detail: parts[parts.length - 1] ?? body.trim(),
  };
}
