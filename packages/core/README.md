# @jadedm/nestjs-verify

Self-hosted Twilio-Verify-style OTP for NestJS. One POST starts a verification, another checks the code. Code generation, TTL, attempt caps, cooldowns, rate limits, and abuse heuristics live in the library. You bring the SMS or email provider and the stores.

```bash
pnpm add @jadedm/nestjs-verify
# + at least one provider and one store-adapter package
pnpm add @jadedm/nestjs-verify-twilio @jadedm/nestjs-verify-postgres
```

## Minimal wiring (dev)

```ts
import { Module } from '@nestjs/common';
import {
  VerifyModule,
  MockSmsProvider,
  createMemoryStores,
} from '@jadedm/nestjs-verify';

@Module({
  imports: [
    VerifyModule.forRoot({
      sms: { provider: new MockSmsProvider() },
      stores: createMemoryStores(),
      code: { fixedCode: '123456' },   // dev only; warns at boot
    }),
  ],
})
export class AppModule {}
```

## Production wiring

```ts
import { VerifyModule } from '@jadedm/nestjs-verify';
import { TwilioSmsProvider } from '@jadedm/nestjs-verify-twilio';
import { createPostgresStores } from '@jadedm/nestjs-verify-postgres';

VerifyModule.forRootAsync({
  useFactory: async () => ({
    sms: {
      provider: new TwilioSmsProvider({
        accountSid: process.env.TWILIO_ACCOUNT_SID!,
        authToken:  process.env.TWILIO_AUTH_TOKEN!,
        from:       process.env.TWILIO_FROM!,
      }),
    },
    stores: await createPostgresStores({ connectionString: process.env.DATABASE_URL! }),
  }),
});
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
  // Set here, not in useFactory: the controller list is fixed before the
  // factory runs. false leaves POST /verify/start and /verify/check unmounted,
  // for apps that call VerifyService from their own routes.
  registerController: true,
  inject: [ConfigService],
  useFactory: (c) => ({
    sms: { provider: ..., fallbacks: [...] },
    stores: {
      verify, abuse,        // durable
      rateLimit, cooldown, phoneIndex,   // ephemeral
    },
    code:       { length: 6, ttlSeconds: 600, fixedCode: undefined },
    attempts:   { max: 5, cooldownSeconds: 30 },
    delivery:   { attemptTimeoutMs: 5000, totalTimeoutMs: 10000, fallbackAfterUncertain: true },
    rateLimit:  { perPhone: { count: 5, windowSeconds: 3600 } },
    abuse:      { maxDistinctPhonesPerIp: 10, velocityWindowSeconds: 300 },
    messageTemplate: 'Your code is {{code}}',
    logging:    { verbose: false },
  }),
})
```

`delivery` bounds how long `POST /verify/start` waits on providers. An attempt that runs past `attemptTimeoutMs` counts as a failure and, by default, the next provider in `fallbacks` is tried; once `totalTimeoutMs` is spent, no further provider is tried and the request fails with 503 `SMS_DISPATCH_FAILED`. Each attempt's `send` gets an `AbortSignal` that fires at its limit. A request already in flight may still deliver: a fallback can then send a second message carrying the same code, and when every attempt times out, the 503 may follow a message that did arrive. Because of that, whenever a message may have gone out (an attempt timed out, a provider marked its error `mayHaveSent: true`, or the send succeeded and the bookkeeping after it failed), the 503 also starts the recipient's cooldown and, when that write succeeds, carries `retryAfterMs`, so an immediate retry gets 429 rather than starting another send. When every provider answered with an unmarked error, the core treats nothing as in flight: no cooldown starts and a retry is accepted at once. The cooldown stops the user's next retry, not a provider's own internal retries: Twilio and Gupshup retry a 500, 502, 504 or network failure inside one send, and such a retry can deliver the same code again; pass `retryAfterUncertain: false` to either provider to stop that. The core likewise tries the next provider in `fallbacks` after a possibly delivered attempt, which can also send the code twice; set `delivery.fallbackAfterUncertain: false` to stop the chain there instead (the request then answers 503, with `retryAfterMs` when the cooldown write succeeds). A start then sends at most once only when every provider in the chain marks its uncertain failures and does not retry after them: Twilio and Gupshup with `retryAfterUncertain: false` do; SES (the AWS SDK retries internally and does not mark errors), a Twilio or Gupshup provider left at its default, and custom providers that do not mark errors do not. The cost is fewer codes getting through when a provider is flaky. Limits above 2147483647 ms are refused, because Node's timers cannot represent them.

## The five stores

The architectural shape of 0.3.0 onward. Every piece of state lives behind a store interface.

| Store | What it holds | Backed by |
|---|---|---|
| `VerifyStore` | Pending and terminal verification records, the source of truth | Postgres, Mongo |
| `AbuseStore` | Send-attempt history for IP/phone velocity heuristics. Optional. | Postgres, Mongo |
| `RateLimitStore` | Fixed-window counter per phone and per IP. Atomic. | Postgres, Mongo, Redis |
| `CooldownStore` | Per-phone cooldown between sends. Returns ms remaining. | Postgres, Mongo, Redis |
| `PhoneIndexStore` | Phone -> sid lookup so check() does not need the sid | Postgres, Mongo, Redis |

You can use a single backend for all five, or split durable vs ephemeral (Postgres for `verify` and `abuse`, Redis for the other three) for speed.

## Peers

- `@nestjs/common`, `@nestjs/core`: 9, 10, or 11
- `reflect-metadata`, `rxjs`

No `@nestjs/cache-manager` peer dep. State is managed through the store interfaces.

## Email codes

Configure `email` (alongside `sms`, or on its own; at least one is required) and start with `channel: 'email'` and an address in `to`. `check` takes the address as it takes a phone. The whole address is lowercased for cooldowns, rate limits and lookup, so case variants of one mailbox share them; plus-addressing and Gmail dot variants are not folded. The code is sent to the address as given. A failed email send returns `SMS_DISPATCH_FAILED`. `MockEmailProvider` logs instead of sending. `voice` and `whatsapp` are rejected with `CHANNEL_NOT_SUPPORTED`.

## Provider and store adapters

| Concern | Package |
|---|---|
| Twilio SMS | [`@jadedm/nestjs-verify-twilio`](https://www.npmjs.com/package/@jadedm/nestjs-verify-twilio) |
| Amazon SES email | [`@jadedm/nestjs-verify-ses`](https://www.npmjs.com/package/@jadedm/nestjs-verify-ses) |
| Postgres (all 5 stores) | [`@jadedm/nestjs-verify-postgres`](https://www.npmjs.com/package/@jadedm/nestjs-verify-postgres) |
| Mongo (all 5 stores) | [`@jadedm/nestjs-verify-mongo`](https://www.npmjs.com/package/@jadedm/nestjs-verify-mongo) |
| Redis (rate limit, cooldown, phone index) | [`@jadedm/nestjs-verify-redis`](https://www.npmjs.com/package/@jadedm/nestjs-verify-redis) |

Bring your own: implement `SmsProvider` or `EmailProvider` for a new vendor, or `VerifyStore` / `AbuseStore` for a different database. The interfaces are tiny and re-exported from this package.

A provider whose request may have been accepted before it failed (a connection reset after the request left, an HTTP 500, 502 or 504, a response whose body could not be read) should throw an error with `mayHaveSent: true` set on it. The core then starts the recipient's cooldown so the user's immediate retry cannot send a second message. Only the exact value `true` counts; leave it unset when the request certainly did not reach the vendor (refused connection, DNS failure, unreachable host, connect timeout, 429, 503, a 4xx). When unsure, setting it costs at most one cooldown.

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
