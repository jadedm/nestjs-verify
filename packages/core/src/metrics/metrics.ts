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
  // Handed back to the user; also asked for a collector it already holds.
  getSingleMetric?(name: string): unknown;
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
  startsTotal(channel?: string): void;
  startsBlocked(reason: BlockReason, channel?: string): void;
  checksTotal(outcome: CheckOutcome, channel?: string): void;
  /** One per start: the per-recipient limit was consulted. */
  recipientRateLimitHits(channel?: string): void;
  sendDuration(channel: string, provider: string, outcome: SmsOutcome, seconds: number): void;
  checkDuration(seconds: number, channel?: string): void;
  /** @deprecated Use recipientRateLimitHits; removed in 1.0 (#7). */
  phoneRateLimitHits(): void;
  /** @deprecated Use sendDuration('sms', ...); removed in 1.0 (#7). */
  smsSendDuration(provider: string, outcome: SmsOutcome, seconds: number): void;
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
  recipientRateLimitHits(): void {}
  sendDuration(): void {}
  checkDuration(): void {}
  phoneRateLimitHits(): void {}
  smsSendDuration(): void {}
  getRegistry(): undefined {
    return undefined;
  }
}

// A label value for a caller that names no channel (a custom caller of the
// recorder); core always passes one.
const UNKNOWN_CHANNEL = 'unknown';

class PromMetricsRecorder implements MetricsRecorder {
  private readonly registry: PromRegistry;
  private readonly startsCounter: PromCounter;
  private readonly startsBlockedCounter: PromCounter;
  private readonly checksCounter: PromCounter;
  private readonly recipientRateLimitHitsCounter: PromCounter;
  private readonly phoneRateLimitHitsCounter: PromCounter;
  private readonly sendDurationHistogram: PromHistogram;
  private readonly smsSendDurationHistogram: PromHistogram;
  private readonly checkDurationHistogram: PromHistogram;

  constructor(
    private readonly prom: PromModule,
    prefix: string,
    registry?: PromRegistry,
  ) {
    this.registry = registry ?? new prom.Registry();
    // A collector already on this registry under the name is reused: a second
    // recorder on one registry (two VerifyModules, a test harness) otherwise
    // throws "already been registered". Different labels or another metric
    // type under one name are refused at construction rather than mixed;
    // different histogram buckets are not compared.
    const existing = (name: string, labelNames: string[], type: 'counter' | 'histogram'): unknown => {
      const found = this.registry.getSingleMetric?.(name) as { labelNames?: string[] } & Record<string, unknown> | undefined;
      if (!found) return undefined;
      // Another type (a counter where a histogram belongs, a gauge or summary)
      // would fail on the first request or export the wrong type. prom-client
      // sets `type` on every metric, also in another copy of the package.
      if (found.type !== type) {
        throw new Error(`metric ${name} is already registered as a ${String(found.type)}, not a ${type}.`);
      }
      // With exemplars on, prom-client 15 takes inc/observe arguments in
      // another shape: a counter drops its labels, a histogram throws.
      if (found.enableExemplars) {
        throw new Error(`metric ${name} is already registered with exemplars enabled, which this recorder does not use.`);
      }
      const same = [...(found.labelNames ?? [])].sort().join() === [...labelNames].sort().join();
      if (!same) {
        throw new Error(`metric ${name} is already registered with labels [${found.labelNames?.join(', ')}], not [${labelNames.join(', ')}].`);
      }
      return found;
    };
    const opts = (name: string, help: string, labelNames: string[] = []) => ({
      name: prefix + name,
      help,
      labelNames,
      registers: [this.registry],
    });
    const counter = (name: string, help: string, labelNames: string[] = []): PromCounter =>
      (existing(prefix + name, labelNames, 'counter') as PromCounter | undefined) ?? new prom.Counter(opts(name, help, labelNames));
    const histogram = (name: string, help: string, labelNames: string[] = []): PromHistogram =>
      (existing(prefix + name, labelNames, 'histogram') as PromHistogram | undefined) ?? new prom.Histogram(opts(name, help, labelNames));

    this.startsCounter = counter(METRICS.COUNTER_STARTS, 'Verifications started.', [METRICS.LABEL_CHANNEL]);
    this.startsBlockedCounter = counter(
      METRICS.COUNTER_STARTS_BLOCKED,
      'Verification starts blocked before code dispatch.',
      [METRICS.LABEL_REASON, METRICS.LABEL_CHANNEL],
    );
    this.checksCounter = counter(METRICS.COUNTER_CHECKS, 'Code checks attempted.', [
      METRICS.LABEL_OUTCOME,
      METRICS.LABEL_CHANNEL,
    ]);
    this.recipientRateLimitHitsCounter = counter(
      METRICS.COUNTER_RECIPIENT_RATE_LIMIT_HITS,
      'Per-recipient rate limit counter hits.',
      [METRICS.LABEL_CHANNEL],
    );
    this.phoneRateLimitHitsCounter = counter(
      METRICS.COUNTER_PHONE_RATE_LIMIT_HITS,
      'Deprecated: the same events as recipient_rate_limit_hits_total, without channel; do not add the two. Removed in 1.0.',
    );
    this.sendDurationHistogram = histogram(
      METRICS.HIST_SEND_DURATION,
      'Wall-clock duration of a code send attempt (SMS or email), seconds.',
      [METRICS.LABEL_CHANNEL, METRICS.LABEL_PROVIDER, METRICS.LABEL_OUTCOME],
    );
    this.smsSendDurationHistogram = histogram(
      METRICS.HIST_SMS_SEND_DURATION,
      'Deprecated: the SMS sends of send_duration_seconds; do not add the two. Removed in 1.0.',
      [METRICS.LABEL_PROVIDER, METRICS.LABEL_OUTCOME],
    );
    this.checkDurationHistogram = histogram(
      METRICS.HIST_CHECK_DURATION,
      'Wall-clock duration of a verify.check call, seconds.',
      [METRICS.LABEL_CHANNEL],
    );
  }

  startsTotal(channel = UNKNOWN_CHANNEL): void {
    this.startsCounter.inc({ [METRICS.LABEL_CHANNEL]: channel });
  }
  startsBlocked(reason: BlockReason, channel = UNKNOWN_CHANNEL): void {
    this.startsBlockedCounter.inc({ [METRICS.LABEL_REASON]: reason, [METRICS.LABEL_CHANNEL]: channel });
  }
  checksTotal(outcome: CheckOutcome, channel = UNKNOWN_CHANNEL): void {
    this.checksCounter.inc({ [METRICS.LABEL_OUTCOME]: outcome, [METRICS.LABEL_CHANNEL]: channel });
  }
  recipientRateLimitHits(channel = UNKNOWN_CHANNEL): void {
    this.recipientRateLimitHitsCounter.inc({ [METRICS.LABEL_CHANNEL]: channel });
    this.phoneRateLimitHitsCounter.inc();
  }
  sendDuration(channel: string, provider: string, outcome: SmsOutcome, seconds: number): void {
    this.sendDurationHistogram.observe(
      { [METRICS.LABEL_CHANNEL]: channel, [METRICS.LABEL_PROVIDER]: provider, [METRICS.LABEL_OUTCOME]: outcome },
      seconds,
    );
    // The deprecated histogram keeps its meaning: SMS sends only.
    if (channel !== 'sms') return;
    this.smsSendDurationHistogram.observe(
      { [METRICS.LABEL_PROVIDER]: provider, [METRICS.LABEL_OUTCOME]: outcome },
      seconds,
    );
  }
  checkDuration(seconds: number, channel = UNKNOWN_CHANNEL): void {
    this.checkDurationHistogram.observe({ [METRICS.LABEL_CHANNEL]: channel }, seconds);
  }
  phoneRateLimitHits(): void {
    this.recipientRateLimitHits();
  }
  smsSendDuration(provider: string, outcome: SmsOutcome, seconds: number): void {
    this.sendDuration('sms', provider, outcome, seconds);
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
