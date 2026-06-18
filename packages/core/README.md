# @jadedm/nestjs-verify

Self-hosted Twilio-Verify-style OTP for NestJS. One POST starts a verification, another checks the code. Code generation, TTL, attempt caps, cooldowns, rate limits, and abuse heuristics live in the library. You bring the SMS provider and the store.

```bash
pnpm add @jadedm/nestjs-verify @nestjs/cache-manager cache-manager
# + at least one provider and one store, e.g.
pnpm add @jadedm/nestjs-verify-twilio @jadedm/nestjs-verify-postgres
```

## Minimal wiring

```ts
import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { VerifyModule, MemoryVerifyStore, MemoryAbuseStore } from '@jadedm/nestjs-verify';
import { TwilioSmsProvider } from '@jadedm/nestjs-verify-twilio';

@Module({
  imports: [
    CacheModule.register({ isGlobal: true }),
    VerifyModule.forRoot({
      sms: {
        provider: new TwilioSmsProvider({
          accountSid: process.env.TWILIO_ACCOUNT_SID!,
          authToken:  process.env.TWILIO_AUTH_TOKEN!,
          from:       process.env.TWILIO_FROM!,
        }),
      },
      stores: {
        verify: new MemoryVerifyStore(),   // swap for Postgres / Mongo in prod
        abuse:  new MemoryAbuseStore(),
      },
    }),
  ],
})
export class AppModule {}
```

That's it. Two routes are mounted automatically:

```
POST /verify/start   { "to": "+14155552671" }
  → 201 { "sid": "vr_...", "state": "pending", "channel": "sms", "expiresAt": "..." }

POST /verify/check   { "to": "+14155552671", "code": "123456" }
  → 201 { "sid": "vr_...", "state": "approved" | "pending" | "canceled", "attemptsRemaining": N }
```

## Configuration

```ts
VerifyModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (c) => ({
    sms: { provider: ..., fallbacks: [...] },     // primary + fallback chain
    stores: { verify, abuse },
    code:       { length: 6, ttlSeconds: 600 },
    attempts:   { max: 5, cooldownSeconds: 30 },
    rateLimit:  { perPhone: { count: 5, windowSeconds: 3600 } },
    abuse:      { maxDistinctPhonesPerIp: 10, velocityWindowSeconds: 300 },
    messageTemplate: 'Your code is {{code}}',
    registerController: true,                     // false = handle routing yourself
  }),
})
```

## Peers

- `@nestjs/common`, `@nestjs/core`: 9, 10, or 11
- `@nestjs/cache-manager`: 2 or 3
- `cache-manager`: 5 or 6 (with `@nestjs/cache-manager@2`, use 5; with 3, use 6)

## Provider & store adapters

| Concern | Package |
|---|---|
| Twilio SMS | [`@jadedm/nestjs-verify-twilio`](https://www.npmjs.com/package/@jadedm/nestjs-verify-twilio) |
| Postgres store | [`@jadedm/nestjs-verify-postgres`](https://www.npmjs.com/package/@jadedm/nestjs-verify-postgres) |
| Mongo store | [`@jadedm/nestjs-verify-mongo`](https://www.npmjs.com/package/@jadedm/nestjs-verify-mongo) |

Bring your own: implement `SmsProvider` for a new SMS vendor or `VerifyStore` / `AbuseStore` for a different database. The interfaces are tiny and re-exported from this package.

## Why

Twilio Verify costs about $0.05 per verification on top of SMS. At scale that adds up, and your OTP state lives inside Twilio's tenant. This library gives you the same surface area on your own infrastructure, with provider choice and pluggable storage.

## Maturity and limitations

This library is in beta. It includes secure primitives but is not yet hardened for enterprise compliance environments. Read this section before adopting it.

### What is in place

* Crypto-random code generation via `crypto.randomInt`.
* Constant-time code comparison via `crypto.timingSafeEqual`.
* Salted SHA-256 storage of codes at rest. The code is never persisted in clear.
* Atomic attempt counters using `UPDATE ... RETURNING` (Postgres) and aggregation pipeline updates (Mongo). Lockout on max attempts happens in a single round trip.
* Per-phone and per-IP rate limiting with fixed window semantics.
* Per-phone cooldown after each send.
* Distinct-phones-per-IP velocity check, configurable window.
* Pluggable provider strategy with a fallback chain.
* TTL on verification records: native TTL index in Mongo, schema-managed expiry in Postgres.
* Phone normalization to E.164.
* Phone-number redaction in this library's own log lines.

### Known gaps before 1.0

These are tracked for the 1.0 milestone. They are not present in 0.x.

1. Atomic rate-limit counters. The current cache-manager implementation does a `get` followed by a `set` and can leak one or two extra requests through under concurrency. For high-throughput deployments, swap to `@nestjs/throttler` with a Redis adapter, or supply your own counter that uses `INCR`.
2. DTO validation with `class-validator`. Input validation today is manual regex on the service. Decorator-based DTO validation is planned.
3. OpenAPI annotations on the built-in controller.
4. Integration tests against live Postgres and Mongo using testcontainers. Current test coverage exercises the in-memory store and the Twilio retry policy only.
5. Delivery receipt handling. The library dispatches via the SMS provider but does not yet process delivery callbacks (Twilio DLR webhooks).

### Not in scope for 1.0

These may be added later or ship as separate modules. Plan deployments accordingly.

1. OpenTelemetry spans and Prometheus metrics. Likely to arrive as separate packages so consumers can opt in.
2. Multi-tenant isolation. Rate-limit and cooldown state is keyed by phone alone today. Two tenants in one deployment share state for a phone number that exists in both. If you need per-tenant isolation, wrap the service in your own tenant-scoping layer or open an issue describing the shape you need.
3. Tamper-evident audit log. The audit concern will ship as a separate module. Until then, you can subscribe to send attempts via the `AbuseStore` interface and persist whatever shape you need.
4. Internationalized message templates. `messageTemplate` is a single string today.
5. KMS-backed code hashing. SHA-256 with a random salt is the current primitive.

### How to evaluate suitability for your project

Use the library when:

* Your verification volume is moderate (single-digit to low thousands of verifications per minute).
* You can tolerate fixed-window rate limiting at low single-digit accuracy at peak concurrency.
* You do not yet need provider delivery receipt processing.
* Compliance requirements do not yet require a tamper-evident audit log.

Defer adoption when:

* You require strict atomicity guarantees on rate limits at high concurrency.
* You require SOC 2 or PCI evidence trails out of the box.
* You require multi-tenant isolation of OTP state today.

If you adopt it for a use case in the second list, expect to add the missing pieces yourself or wait for the matching milestone.

## Consulting

If you need integration help, a custom provider or store adapter, or fractional CTO support shipping this into production, see [manishj.com](https://manishj.com).

## License

MIT. Manish Jadhav ([@jadedm](https://github.com/jadedm)).
