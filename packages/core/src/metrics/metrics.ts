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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    prom = require('prom-client') as PromModule;
  } catch {
    log.warn(
      'observability.metrics.enabled is true, but prom-client is not installed; skipping metrics. ' +
        'pnpm add prom-client to enable.',
    );
    return new NoopMetricsRecorder();
  }
  const prefix = opts.prefix ?? METRICS.DEFAULT_PREFIX;
  return new PromMetricsRecorder(prom, prefix, opts.registry as PromRegistry);
}

export { BLOCK_REASON, CHECK_OUTCOME, SMS_OUTCOME };
