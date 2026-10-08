import { Logger } from '@nestjs/common';
import {
  BLOCK_REASON,
  BlockReason,
  CHECK_OUTCOME,
  CheckOutcome,
  METRICS,
  SMS_OUTCOME,
  SmsOutcome,
} from '../constants.js';

/**
 * Minimal shape of prom-client used by the metrics layer. Lets us treat
 * prom-client as an optional peer dep without binding the library types
 * to it.
 */
interface PromCounter {
  inc(labels?: Record<string, string>, value?: number): void;
}
interface PromHistogram {
  observe(labels: Record<string, string>, value: number): void;
}
interface PromRegistry {
  // we only need to hand it back to the user
}

interface PromModule {
  Counter: new (opts: {
    name: string;
    help: string;
    labelNames?: string[];
    registers?: unknown[];
  }) => PromCounter;
  Histogram: new (opts: {
    name: string;
    help: string;
    labelNames?: string[];
    buckets?: number[];
    registers?: unknown[];
  }) => PromHistogram;
  Registry: new () => PromRegistry;
}

export interface MetricsRecorder {
  startsTotal(): void;
  startsBlocked(reason: BlockReason): void;
  checksTotal(outcome: CheckOutcome): void;
  phoneRateLimitHits(): void;
  smsSendDuration(provider: string, outcome: SmsOutcome, seconds: number): void;
  checkDuration(seconds: number): void;
  /** Returns the prom-client Registry so the user can wire their /metrics endpoint. */
  getRegistry(): PromRegistry | undefined;
}

/**
 * No-op recorder. Used when metrics are disabled. Each method is a tiny
 * function call with no allocation, so the runtime cost is essentially zero.
 */
class NoopMetricsRecorder implements MetricsRecorder {
  startsTotal(): void {}
  startsBlocked(): void {}
  checksTotal(): void {}
  phoneRateLimitHits(): void {}
  smsSendDuration(): void {}
  checkDuration(): void {}
  getRegistry(): undefined {
    return undefined;
  }
}

class PromMetricsRecorder implements MetricsRecorder {
  private readonly registry: PromRegistry;
  private readonly startsCounter: PromCounter;
  private readonly startsBlockedCounter: PromCounter;
  private readonly checksCounter: PromCounter;
  private readonly phoneRateLimitHitsCounter: PromCounter;
  private readonly smsSendDurationHistogram: PromHistogram;
  private readonly checkDurationHistogram: PromHistogram;

  constructor(
    private readonly prom: PromModule,
    prefix: string,
    registry?: PromRegistry,
  ) {
    this.registry = registry ?? new prom.Registry();
    const opts = (name: string, help: string, labelNames: string[] = []) => ({
      name: prefix + name,
      help,
      labelNames,
      registers: [this.registry],
    });
    this.startsCounter = new prom.Counter(
      opts(METRICS.COUNTER_STARTS, 'Verifications started.'),
    );
    this.startsBlockedCounter = new prom.Counter(
      opts(
        METRICS.COUNTER_STARTS_BLOCKED,
        'Verification starts blocked before code dispatch.',
        [METRICS.LABEL_REASON],
      ),
    );
    this.checksCounter = new prom.Counter(
      opts(METRICS.COUNTER_CHECKS, 'Code checks attempted.', [
        METRICS.LABEL_OUTCOME,
      ]),
    );
    this.phoneRateLimitHitsCounter = new prom.Counter(
      opts(
        METRICS.COUNTER_PHONE_RATE_LIMIT_HITS,
        'Per-phone rate limit counter hits.',
      ),
    );
    this.smsSendDurationHistogram = new prom.Histogram(
      opts(
        METRICS.HIST_SMS_SEND_DURATION,
        'Wall-clock duration of an SMS send attempt, seconds.',
        [METRICS.LABEL_PROVIDER, METRICS.LABEL_OUTCOME],
      ),
    );
    this.checkDurationHistogram = new prom.Histogram(
      opts(
        METRICS.HIST_CHECK_DURATION,
        'Wall-clock duration of a verify.check call, seconds.',
      ),
    );
  }

  startsTotal(): void {
    this.startsCounter.inc();
  }
  startsBlocked(reason: BlockReason): void {
    this.startsBlockedCounter.inc({ [METRICS.LABEL_REASON]: reason });
  }
  checksTotal(outcome: CheckOutcome): void {
    this.checksCounter.inc({ [METRICS.LABEL_OUTCOME]: outcome });
  }
  phoneRateLimitHits(): void {
    this.phoneRateLimitHitsCounter.inc();
  }
  smsSendDuration(
    provider: string,
    outcome: SmsOutcome,
    seconds: number,
  ): void {
    this.smsSendDurationHistogram.observe(
      {
        [METRICS.LABEL_PROVIDER]: provider,
        [METRICS.LABEL_OUTCOME]: outcome,
      },
      seconds,
    );
  }
  checkDuration(seconds: number): void {
    this.checkDurationHistogram.observe({}, seconds);
  }
  getRegistry(): PromRegistry {
    return this.registry;
  }
}

const log = new Logger('VerifyMetrics');

/**
 * Build a MetricsRecorder. If metrics are disabled, returns a no-op
 * recorder. If enabled, attempts to load prom-client (optional peer
 * dependency); if absent, falls back to no-op and logs a warning.
 */
export function createMetricsRecorder(opts: {
  enabled?: boolean;
  registry?: unknown;
  prefix?: string;
}): MetricsRecorder {
  if (!opts.enabled) return new NoopMetricsRecorder();
  let prom: PromModule;
  try {
    prom = loadPromClient();
  } catch (err) {
    log.warn(metricsLoadWarning(err));
    return new NoopMetricsRecorder();
  }
  const prefix = opts.prefix ?? METRICS.DEFAULT_PREFIX;
  return new PromMetricsRecorder(prom, prefix, opts.registry as PromRegistry);
}

// Defined only in the ESM build, by a tsup banner (see tsup.config.ts).
declare const __VERIFY_ESM_REQUIRE__: ((id: string) => unknown) | undefined;

/**
 * Loads the optional peer by trying each loader in turn rather than detecting
 * the environment: esbuild rewrites `typeof require` in the ESM build to its
 * own stub, which always looks like a function. The ESM build's helper works
 * in a plain ES module; require works in CommonJS and in bundlers. Each
 * loader also says how it fails when it cannot work in this environment at
 * all, so that failure is set aside and the real error is reported.
 */
type Loader = { load: () => unknown; unavailable: (err: unknown) => boolean };

const errorText = (err: unknown) => {
  const { code, message, stack } = (err ?? {}) as { code?: unknown; message?: unknown; stack?: unknown };
  return { code, message: typeof message === 'string' ? message : '', stack: typeof stack === 'string' ? stack : '' };
};

const loadPromClient = (): PromModule => {
  const loaders: Loader[] = [
    {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      load: () => require('prom-client'),
      // esbuild's ESM stub when no require exists (a plain ES module).
      unavailable: (err) => /Dynamic require of .* is not supported/.test(errorText(err).message),
    },
  ];
  if (typeof __VERIFY_ESM_REQUIRE__ === 'function') {
    const esmRequire = __VERIFY_ESM_REQUIRE__;
    loaders.unshift({
      load: () => esmRequire('prom-client'),
      // Inside a bundle: esbuild to CommonJS empties import.meta, and webpack
      // turns the helper into an empty context or drops createRequire.
      unavailable: (err) => {
        const { code, message, stack } = errorText(err);
        return code === 'ERR_INVALID_ARG_VALUE' || /webpack(Empty)?Context/.test(stack) || /is not a function/.test(message);
      },
    });
  }
  const failures: { err: unknown; unavailable: boolean }[] = [];
  for (const loader of loaders) {
    try {
      return loader.load() as PromModule;
    } catch (err) {
      failures.push({ err, unavailable: loader.unavailable(err) });
    }
  }
  throw (failures.find((f) => !f.unavailable) ?? failures[0]).err;
};

/**
 * Says prom-client is missing only when it is: the first line must name it,
 * since a missing dependency of prom-client also lists prom-client in the
 * require stack below.
 */
const metricsLoadWarning = (err: unknown): string => {
  const { code, message } = (err ?? {}) as { code?: unknown; message?: unknown };
  const firstLine = typeof message === 'string' ? message.split('\n')[0] : '';
  const missing = code === 'MODULE_NOT_FOUND' && /Cannot find (module|package) 'prom-client'/.test(firstLine);
  if (missing) {
    return 'observability.metrics.enabled is true, but prom-client is not installed; skipping metrics. pnpm add prom-client to enable.';
  }
  return `observability.metrics.enabled is true, but prom-client could not be loaded (${typeof message === 'string' ? message : String(err)}); skipping metrics.`;
};

export { BLOCK_REASON, CHECK_OUTCOME, SMS_OUTCOME };
