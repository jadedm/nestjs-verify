import { Cache } from 'cache-manager';

/**
 * Rate limiter backed by NestJS cache-manager. Implements a fixed-window
 * counter keyed by (kind:identifier).
 *
 * Atomicity caveat: cache-manager doesn't expose atomic INCR. Under high
 * concurrency on the *same* phone/IP, two concurrent calls can both read 0
 * and both write 1 — letting one extra request through the window. For OTP
 * traffic this is acceptable: the per-phone limit is small (e.g. 5/hour),
 * and an off-by-one is not a security boundary. For high-concurrency
 * security-critical paths, use the @nestjs/throttler Redis adapter or a
 * native Redis INCR.
 */
export class CacheRateLimiter {
  constructor(private readonly cache: Cache) {}

  private key(kind: string, id: string): string {
    return `verify:ratelimit:${kind}:${id}`;
  }

  async hit(
    kind: string,
    id: string,
    windowSeconds: number,
  ): Promise<number> {
    const k = this.key(kind, id);
    const current = (await this.cache.get<number>(k)) ?? 0;
    const next = current + 1;
    await this.cache.set(k, next, windowSeconds * 1000);
    return next;
  }

  async peek(kind: string, id: string): Promise<number> {
    const k = this.key(kind, id);
    return (await this.cache.get<number>(k)) ?? 0;
  }
}
