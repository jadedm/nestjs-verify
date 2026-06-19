import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { TELEMETRY } from '../constants.js';

export { TELEMETRY };

/**
 * Returns the OpenTelemetry tracer for this library. When no SDK is
 * registered in the host application, the OTel API returns a no-op
 * tracer whose `startActiveSpan` runs the callback directly without
 * emitting anything. So callers can use this helper unconditionally
 * with zero runtime cost when tracing is not configured.
 */
export function getVerifyTracer(serviceName?: string) {
  return trace.getTracer(
    serviceName ?? TELEMETRY.DEFAULT_TRACER_NAME,
    TELEMETRY.DEFAULT_TRACER_VERSION,
  );
}

export interface SpanContext {
  attributes?: Record<string, string | number | boolean | undefined>;
}

/**
 * Runs `fn` inside an active span. Sets the supplied attributes, records
 * any thrown exception on the span, and sets the span status appropriately
 * before re-throwing.
 */
export async function withSpan<T>(
  name: string,
  ctx: SpanContext,
  fn: (span: Span) => Promise<T>,
  serviceName?: string,
): Promise<T> {
  const tracer = getVerifyTracer(serviceName);
  return tracer.startActiveSpan(name, async (span) => {
    setAttributes(span, ctx.attributes);
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (err as Error).message,
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

function setAttributes(
  span: Span,
  attrs?: Record<string, string | number | boolean | undefined>,
): void {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    span.setAttribute(k, v);
  }
}
