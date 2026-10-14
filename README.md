# nestjs-verify

Self-hosted OTP for NestJS, in the shape of Twilio Verify. One POST starts a verification, another checks the code. Code generation, TTL, attempt caps, cooldowns, rate limits, and abuse heuristics live in the library. You pick the SMS or email provider and the stores.

## What 1.0 promises

Every exported interface, type, option, error code, metric name and store contract stays compatible through 1.x. A 1.x minor adds; it never removes or changes what you already use. A breaking change waits for 2.0. Node 22.12 or newer and Nest 11 or 12 are supported; a new Node or Nest major is added in a minor, and dropping one is a 2.0 change. All seven packages are at 1.0.0 together, and every adapter accepts core `>=0.9.0 <2.0.0`.

## Upgrading to 1.0.0

Upgrade to 0.9 first and clear its deprecation warnings: 1.0 removes everything 0.9 kept under its old name (the table below).

- Requirements: Node 22.12 or newer; `@nestjs/common` and `@nestjs/core` 11 or 12; `@nestjs/swagger` 11 or 12, matching Nest's major; `class-validator` 0.14 or 0.15; `rxjs` 7.1 or newer.
- Removed: every 0.9 alias in the table below, the metric series `verify_sms_send_duration_seconds` and `verify_phone_rate_limit_hits_total`, the span attribute `verify.phone_redacted`, the audit meta `distinctPhones`, the `LoggerAuditSink` key `phone`, `MetricsRecorder.smsSendDuration` and `phoneRateLimitHits`, and `incrementAttempts` with `IncrementResult` (unused since 0.8).
- `stores.phoneIndex`, `rateLimit.perPhone` and `abuse.maxDistinctPhonesPerIp` are refused at boot with an error naming the 1.0 name, so an old config is never quietly ignored.
- Custom stores: `AbuseStore` requires `recordSendAttempt` and `countDistinctRecipientsByIp` only; records, send attempts and audit events carry `recipient` and `recipientRedacted`.
- No database migration: tables, columns and fields keep their names.

## Upgrading to 0.9.0

0.9.0 renames everything that said phone but also holds an email address (#8). The old names keep working in 0.9 and log a deprecation warning at boot; 1.0 removes them.

| Before 0.9.0 | From 0.9.0 |
|---|---|
| `stores.phoneIndex`, `PhoneIndexStore` | `stores.recipientIndex`, `RecipientIndexStore` |
| `MemoryPhoneIndexStore`, `PostgresPhoneIndexStore`, `MongoPhoneIndexStore`, `RedisPhoneIndexStore` | `...RecipientIndexStore` |
| `rateLimit.perPhone` | `rateLimit.perRecipient` |
| `abuse.maxDistinctPhonesPerIp` | `abuse.maxDistinctRecipientsPerIp` |
| `VerificationRecord.phone`, `SendAttempt.phone` | `recipient` |
| `AbuseStore.countAttemptsByPhone`, `countDistinctPhonesByIp` | `countAttemptsByRecipient`, `countDistinctRecipientsByIp` |
| `AuditEvent.phoneRedacted` | `recipientRedacted` |
| error code `PHONE_RATE_LIMITED` | `RECIPIENT_RATE_LIMITED` |
| metric `verify_sms_send_duration_seconds` | `verify_send_duration_seconds{channel}`, which also times email |
| metric `verify_phone_rate_limit_hits_total` | `verify_recipient_rate_limit_hits_total{channel}` |
| `verify_starts_blocked_total{reason="phone_rate_limit"}`, audit outcome `phone_rate_limit` | `recipient_rate_limit` |
| span attribute `verify.phone_redacted`, audit meta `distinctPhones`, `LoggerAuditSink` key `phone` | `verify.recipient_redacted`, `distinctRecipients`, `recipient` |

- `verify_starts_total`, `verify_starts_blocked_total`, `verify_checks_total` and `verify_check_duration_seconds` gain a `channel` label. Sums and rates over them are unchanged; a query that matches their exact label set needs the new label. Until 1.0 the old `verify_phone_rate_limit_hits_total` counts the same events as the new counter, and `verify_sms_send_duration_seconds` the SMS sends of the new histogram; do not add old and new.
- The `phone_rate_limit` reason and audit outcome change with no alias, because emitting both would count every block twice. A TypeScript class implementing the exported `MetricsRecorder` interface must add `sendDuration` and `recipientRateLimitHits`.
- `RecipientIndexStore.set` takes the record's `createdAt` as a fourth argument and must not replace a live entry created later (#82). A custom index store that ignores it still works, without that protection.
- Postgres: migration 4 adds `created_at` to `verify_phone_index`. Upgrade every instance of the Postgres adapter together: an older adapter refuses to start against the newer schema.
- Redis: index values become `sid|createdAt`. During a rolling deploy an older Redis adapter cannot read an entry written by a newer one, so a code started on a new instance answers `NO_PENDING_VERIFICATION` on an old one until the deploy finishes. Deploy the Redis adapter to all instances at once.
- `VerifyStore.create` takes the TTL as a second argument; a store that uses it sets `expiresAt` from its own clock and returns it (#108). The shipped Postgres and Mongo stores do, so a code's deadline is set and judged on the database clock, and the start response carries it. Core no longer compares `expiresAt` with the app server's clock, so a custom store's `reserveAttempt` is now the only expiry check: it must refuse an expired record, as the interface has required since 0.8.0. A custom store that ignores the TTL keeps the app server's deadline.
- The error code is the one change with no alias, because a response carries one code. A client that compares `code` with the string `'PHONE_RATE_LIMITED'` must change; one that compares with `VerifyErrorCode.PhoneRateLimited` keeps working, since that deprecated constant now holds the new code.
- The `create*Stores` factories return the index store as `recipientIndex`, and also as `phoneIndex` for code that reads the old name. `phoneIndex` is not enumerable, so a spread such as `{ ...pgStores, recipientIndex: redisStores.recipientIndex }` uses the Redis index. On the factory object itself the two names always hold the same store, whichever one is set. A 0.8 setup that spreads and sets `phoneIndex` also still works, with a warning; that warning also fires when both names are written by hand with different stores, and `phoneIndex` is used.
- A custom store written for 0.8 keeps running: core writes both field names and falls back to the old method names. Its TypeScript needs `recipient` on the records it returns.
- Database tables and columns keep their names; no migration.

## Upgrading to 0.7.0

0.7.0 is a breaking change for custom stores only. The shipped memory, Postgres, Mongo and Redis stores already implement the new methods.

- `CooldownStore` gains `claim(key, seconds, holder)` and `release(key, holder)`. `start` claims the cooldown atomically before it sends, so simultaneous starts for one recipient send one code; the others get `COOLDOWN_ACTIVE`.
- `PhoneIndexStore` gains `deleteIfMatches(phone, sid)`. Cleanup removes a recipient's index entry only while it still points at that verification, so it can no longer remove a newer one.
- `VerifyService` refuses, when it is constructed, a store that lacks any of these methods.
- Postgres: migration 3 adds a `holder` column to `verify_cooldowns`. `createPostgresStores` applies it on start; with `skipSchemaSetup`, apply it from the exported `MIGRATIONS` before upgrading.
- A second `check` of an expired, locked-out or finished verification now answers `NO_PENDING_VERIFICATION` instead of `canceled`, as it already did after an approval.

The changelogs in each package carry the details.

## Migrating from 0.2.x to 0.3.0

0.3.0 is a breaking change. The library no longer depends on `@nestjs/cache-manager`. State is now organized behind five store interfaces, with one adapter per backend.

```diff
- import { CacheModule } from '@nestjs/cache-manager';
- import { MemoryVerifyStore, MemoryAbuseStore } from '@jadedm/nestjs-verify';
+ import { createMemoryStores } from '@jadedm/nestjs-verify';

  @Module({
    imports: [
-     CacheModule.register({ isGlobal: true }),
      VerifyModule.forRoot({
        sms: { provider: ... },
-       stores: {
-         verify: new MemoryVerifyStore(),
-         abuse:  new MemoryAbuseStore(),
-       },
+       stores: createMemoryStores(),
      }),
    ],
  })
```

For production, the migration is a single factory call per backend:

```ts
import { createPostgresStores } from '@jadedm/nestjs-verify-postgres';
const stores = await createPostgresStores({ connectionString });
VerifyModule.forRoot({ sms: { provider }, stores });
```

The factory runs idempotent migrations under an advisory lock. Existing `verifications` and `verify_abuse_log` tables are unchanged. Three new tables are created on first start: `verify_rate_limits`, `verify_cooldowns`, `verify_phone_index`. Mongo gets equivalent collections with TTL indexes.

The wire shape of `/verify/start` and `/verify/check` is unchanged. The only newly-surfaced wire field is `retryAfterMs` on 429 cooldown responses.

## Install

```bash
pnpm add @jadedm/nestjs-verify
pnpm add @jadedm/nestjs-verify-twilio
pnpm add @jadedm/nestjs-verify-postgres     # or -mongo, or -redis for ephemeral
```

## Packages

| Package | Purpose |
|---|---|
| [`@jadedm/nestjs-verify`](./packages/core) | Core module, service, five store interfaces, in-memory stores, mock SMS and email providers |
| [`@jadedm/nestjs-verify-twilio`](./packages/provider-twilio) | Twilio SMS provider adapter with transient-error retry |
| [`@jadedm/nestjs-verify-gupshup`](./packages/provider-gupshup) | Gupshup SMS provider adapter (India and SEA market) |
| [`@jadedm/nestjs-verify-ses`](./packages/provider-ses) | Amazon SES email provider adapter |
| [`@jadedm/nestjs-verify-postgres`](./packages/store-postgres) | All five stores against Postgres. Atomic ops, migration runner with advisory lock |
| [`@jadedm/nestjs-verify-mongo`](./packages/store-mongo) | All five stores against Mongo. Atomic ops via aggregation pipelines, TTL indexes |
| [`@jadedm/nestjs-verify-redis`](./packages/store-redis) | Three ephemeral stores against Redis. Atomic INCR via Lua. Pair with a durable store. |

All packages publish independently to npm and version via Changesets. Each adapter names the core versions it supports in its `peerDependencies`.

## Quickstart

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
      code: { fixedCode: '123456' },     // dev only; loud warning at boot
    }),
  ],
})
export class AppModule {}
```

```bash
curl -X POST http://localhost:3000/verify/start \
  -H 'Content-Type: application/json' \
  -d '{"to":"+14155552671"}'
# 201 {"sid":"vr_...","state":"pending","channel":"sms","expiresAt":"..."}

curl -X POST http://localhost:3000/verify/check \
  -H 'Content-Type: application/json' \
  -d '{"to":"+14155552671","code":"123456"}'
# 201 {"sid":"vr_...","state":"approved","attemptsRemaining":0}
```

For production, swap `MockSmsProvider` for `TwilioSmsProvider` and `createMemoryStores()` for `await createPostgresStores({ connectionString })` (or `createMongoStores`, or a mix with `createRedisStores` for the ephemeral half).

## Email codes

Configure `email` alongside or instead of `sms`, then start with `channel: 'email'`:

```ts
import { SesEmailProvider } from '@jadedm/nestjs-verify-ses';

VerifyModule.forRoot({
  email: {
    provider: new SesEmailProvider({ from: 'no-reply@example.com', region: 'ap-south-1' }),
    subject: 'Your sign-in code',
  },
  stores: createMemoryStores(),
});
```

```bash
curl -X POST http://localhost:3000/verify/start \
  -H 'Content-Type: application/json' \
  -d '{"to":"admin@example.com","channel":"email"}'
```

`check` takes the address in `to` as for a phone. The whole address is lowercased for cooldowns, rate limits and lookup, so case variants of one mailbox share them; the code is sent to the address as given. The IP velocity check counts addresses as it counts phones. Provider errors have the address replaced with `[recipient]` before they are logged. Plus-addressing and provider-specific dot rules (`a+1@gmail.com`, `a.b@gmail.com`) are not folded, so each is its own key; the per-IP limits still apply. A failed email send returns `SMS_DISPATCH_FAILED`, the same code as a failed SMS. Store fields named `phone` hold the address. `MockEmailProvider` logs instead of sending, for development and tests.

## State machine

```mermaid
stateDiagram-v2
    direction LR
    [*] --> pending: POST /verify/start
    pending --> approved: POST /verify/check (correct code)
    pending --> canceled: attempts exhausted, or markStatus
    pending --> expired: past expiresAt on next read
    approved --> [*]
    canceled --> [*]
    expired --> [*]
```

A verification is created in `pending`. It transitions exactly once, to `approved`, `canceled`, or `expired`. The wire representation calls the field `state`, distinct from JSend-style envelope `status`.

## Comparison with Twilio Verify

| | Twilio Verify | `@jadedm/nestjs-verify` |
|---|---|---|
| Code generation | Twilio | Library (`crypto.randomInt`) |
| Code storage | Twilio's tenant | Your database, salted SHA-256 |
| Attempt cap, cooldown, rate limits | Built in | Built in |
| Fraud Guard | Built in | Basic velocity check, pluggable |
| Channels | SMS, voice, email, WhatsApp | SMS and email; voice and WhatsApp are rejected with `CHANNEL_NOT_SUPPORTED` |
| Pricing at scale | ~$0.05 per verification on top of SMS | Cost of your SMS or email provider only |
| Provider lock-in | Twilio | Choose: Twilio or Gupshup for SMS, SES for email, or your own |
| Data residency | Twilio's regions | Wherever your DB runs |
| DLR / delivery feedback | Built in | Not yet (see [Maturity](./packages/core/README.md#maturity-and-limitations)) |
| SOC 2 evidence | Inherited from Twilio | Your responsibility |

The trade-off is honest: you trade Twilio's compliance and managed surface for control, lower per-verify cost, and the ability to swap SMS providers without changing application code.

## Maturity

1.0: the public interface is frozen through 1.x (see What 1.0 promises, above). The cryptographic primitives are sound and the store atomicity is correct; several features expected of enterprise compliance environments are not in it. Read [the full maturity and limitations section](./packages/core/README.md#maturity-and-limitations) in the core package README before adopting.

## Local development

```bash
pnpm install
pnpm build
pnpm test                # unit tests across all packages
pnpm test:adapters       # live adapter smoke against Postgres, Mongo and Redis (needs Docker)
pnpm test:adapters:mongo-drivers   # the Mongo smoke under mongodb 5.0.0, 5.x and 6.x
pnpm --filter basic-twilio-postgres start
```

The runnable example in `examples/basic-twilio-postgres` wires the core, the Twilio provider, and the Postgres store together.

`pnpm test:adapters` spins up Postgres 16, Mongo 7 and Redis 7 in Docker, runs the adapter contract script in `scripts/smoke-adapters.mjs`, and tears the containers down. It is the safest pre-release check for any change that touches a store adapter. See `scripts/README.md` for details.

## Releases

Each package versions independently via [Changesets](https://github.com/changesets/changesets). A `linked` group keeps core, Twilio, Postgres and SES on the same version when they release together; Gupshup, Mongo and Redis version on their own.

To propose a change:

```bash
pnpm changeset       # describe the change, pick affected packages and bump type
git commit -am "..."
git push
# A "Version Packages" PR opens automatically.
```

The maintainer publishes after that PR merges, from their own terminal, with `scripts/publish-manual.sh`. The release workflow can also publish through npm trusted publishing (OIDC); it is switched off ([#19](https://github.com/jadedm/nestjs-verify/issues/19), [#138](https://github.com/jadedm/nestjs-verify/issues/138)).

## License

MIT. Manish Jadhav ([@jadedm](https://github.com/jadedm)).

---

Built by [Manish Jadhav](https://manishj.com).

Need something like this designed or built? [Inoltro](https://inoltro.ai) is my studio.
