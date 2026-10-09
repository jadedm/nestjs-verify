# @jadedm/nestjs-verify

## 0.8.0

### Minor Changes

- a2637d3: Security: `check` now counts the attempt before it compares the code, so simultaneous checks for one verification can no longer compare more codes than `attempts.max`. Before, every check already in flight compared its code before the lockout was written, which let a burst of requests make more guesses than the limit allows.

  Breaking for custom stores: `VerifyStore` has a new required method, `reserveAttempt(sid)`, that increments attempts in one atomic operation only while the record is pending and below `maxAttempts`, and never changes the status. `VerifyService` refuses a verify store without it when it is constructed. `incrementAttempts` is no longer part of the interface; the shipped Postgres, Mongo and memory stores keep it, deprecated.

  A correct code submitted at the same moment as a wrong code that spends the last attempt can be answered `canceled`: the check fails closed rather than allowing an extra guess. A record created with `maxAttempts` of 0 now refuses every code. `reserveAttempt` also refuses a record past its expiry, so a code is never compared after it expires.

  The Postgres and Mongo stores also accept `@jadedm/nestjs-verify` 0.8 as a peer (`>=0.6.8 <0.9.0`).

## 0.7.0

### Minor Changes

- f22a978: Simultaneous starts for one recipient now send one code: the cooldown is claimed atomically before anything else, and the others get `COOLDOWN_ACTIVE` (#13).

  Breaking for custom stores: `CooldownStore` has two new required methods, `claim(key, seconds, holder)` and `release(key, holder)`. `VerifyService` refuses a cooldown store without them when it is constructed. The shipped memory, Postgres, Mongo and Redis stores implement both.

  Postgres: migration 3 adds a `holder` column to `verify_cooldowns`. With `skipSchemaSetup`, apply it before upgrading (it is in the exported `MIGRATIONS`); a custom `tableName` needs the same column. During a rolling upgrade, instances still on 0.6 do not clear `holder` when they start a cooldown, so a 0.7 instance releasing an earlier claim can end that cooldown; finish the rollout before relying on it.

  Behaviour: a refusal before the send (rate limit, abuse check, a store error) and a send that definitely failed leave no cooldown, as before, unless releasing the claim itself fails; the claim then blocks the recipient until it expires (the cooldown, or the send window plus 30 s if that is longer). When a message may have gone out and the cooldown write fails, the 503 now carries `retryAfterMs` for the claim still in force.

- db3c2f2: Cleaning up after one verification no longer removes the recipient's index entry when a newer verification has replaced it, so the newer code still checks (#9). This covers a failed send, a start that lost its cooldown claim, a failed index write, and `check` after an approval, a lockout or an expired code.

  Breaking for custom stores: `PhoneIndexStore` has a new required method, `deleteIfMatches(phone, sid)`, which removes the entry only while it maps `phone` to `sid`, atomically. `VerifyService` refuses a phone index store without it when it is constructed. The shipped stores implement it.

  The index entry now expires with its record rather than a full code TTL after the record was written. `check` now also removes the entry when it finds the record expired, locked out, already finished or missing, so a second `check` after any of those answers `NO_PENDING_VERIFICATION` instead of `canceled`, as it already did after an approval. A failed index cleanup after a lockout is logged rather than answered with a 500.

## 0.6.8

### Patch Changes

- bf29dc0: Metrics work in ES module apps. The optional prom-client peer is loaded with `require()`, which does not exist in an ES module, so with `observability.metrics.enabled: true` an ESM app silently got no metrics and a warning wrongly saying prom-client was not installed. The ESM build now carries a helper that makes a `require` from the package at the moment prom-client is loaded, and the loader tries it before plain `require`. Nothing runs at load, so apps bundled with esbuild or webpack load and record metrics as before; a bundler that inlines the ESM build may print one new build warning about the helper (webpack: "the request of a dependency is an expression"). CommonJS apps were not affected. The warning now says "not installed" only when prom-client itself cannot be found, and otherwise reports the actual load error, for example a missing dependency of prom-client.

## 0.6.7

### Patch Changes

- 85a3dfd: New core option `delivery.fallbackAfterUncertain`, default `true`, which keeps today's behaviour. After a provider attempt that may have been accepted (it timed out, or its error carries `mayHaveSent: true`), the core tries the next provider in `fallbacks`, and that provider can send the same code a second time. With `fallbackAfterUncertain: false`, the chain stops there: the cooldown starts and `POST /verify/start` answers 503, with `retryAfterMs` when the cooldown write succeeds. An attempt that failed outright still moves on to the next provider. A non-boolean value fails at startup. A start sends at most once only when every provider in the chain marks uncertain failures and does not retry after them, such as Twilio and Gupshup with `retryAfterUncertain: false`; SES and unmarked custom providers do not qualify. Twilio and Gupshup: documentation only.

## 0.6.6

### Patch Changes

- c2b3b56: New provider option `retryAfterUncertain` (Twilio and Gupshup), default `true`, which keeps today's behaviour. Both providers retry a 500, 502, 504 or a network failure inside one send; when the failed attempt may already have been accepted, a retry can deliver the same code a second time. With `retryAfterUncertain: false`, such a failure is thrown at once, marked `mayHaveSent`, so the core starts the cooldown and the user retries after it. Failures known not to have sent (429, 503, a refused connection, a DNS failure) are still retried. The option does not stop the core trying the next provider in `fallbacks` (#51). Also fixed: a frozen Twilio error is now wrapped so the may-have-sent mark is not lost, and a Gupshup request aborted by the core now rejects with the abort reason instead of a provider error. The core change is documentation only.

## 0.6.5

### Patch Changes

- 852a54d: A provider error can now say the request may have been accepted, and the core treats it like a timeout: it starts the recipient's cooldown before answering 503, and the 503 carries `retryAfterMs`. Before, an error from a provider was always taken as "nothing sent", so after a 504 or a dropped connection the user's immediate retry could send a second message. Twilio's and Gupshup's own internal retries still run after such a failure and can deliver the same code again (#43).

  - Core: an error with `mayHaveSent: true` (exactly `true`) counts as possibly delivered, including after the recipient scrub that rebuilds provider errors.
  - Twilio and Gupshup set `mayHaveSent: true` on the error they throw when any attempt got HTTP 500, 502 or 504, a response that broke after its headers, or a network error other than a refused connection, DNS failure, unreachable host or network, or (Gupshup) connect timeout. 429 and 503 are not marked. Unknown network errors are marked, which errs toward a cooldown. The property is plain, so these providers still work with older core versions, which ignore it.

## 0.6.4

### Patch Changes

- ea45647: `VerifyModule.forRootAsync` accepts `registerController`. Before, the option existed only on the module options returned by `useFactory`, where it was ignored, because the controller list is fixed before the factory runs: an app that wrapped sign-in in its own routes still exposed `POST /verify/start` and `POST /verify/check`, so anyone could start or check a verification directly. Set `registerController: false` on the `forRootAsync` options to leave them unmounted. A `registerController: false` returned from `useFactory` is now honoured too: the controller is still registered, but its handlers answer 404 and never reach `VerifyService`, and startup logs an error saying where to move the setting. The 404 holds even when the log is not seen, for example with `logger: false` or a request-scoped dependency in `inject`. Global guards and pipes still run before the handler, so a caller can tell the route exists; set the option on `forRootAsync` to remove the routes entirely.

## 0.6.3

### Patch Changes

- 68c23c5: Whenever a message may have gone out, `POST /verify/start` now starts the recipient's cooldown before answering 503 `SMS_DISPATCH_FAILED`, and the 503 body carries `retryAfterMs` when that write succeeded. That covers a send where a provider attempt timed out (the message may still arrive) and a send that succeeded but whose bookkeeping failed. An immediate retry gets 429 `COOLDOWN_ACTIVE` instead of starting another send. The cooldown is written before the failure cleanup, so a failing store cannot skip it. When every provider answered with an error rather than timing out, nothing changes: no cooldown, and a retry is accepted at once. Cleanup after a failed start no longer turns the 503 into a 500 when a store fails, and each cleanup step runs even if an earlier one failed.

  Also fixed: a provider whose `send` threw synchronously skipped the scrub that removes the recipient from error messages, so a phone number or address could reach logs and the abuse record.

## 0.6.2

### Patch Changes

- eb3a762: Provider sends now have time limits. Before, a provider that never answered held `POST /verify/start` open indefinitely and the fallbacks were never tried.

  - New `delivery` option: `attemptTimeoutMs` (default 5000) limits one provider attempt, and `totalTimeoutMs` (default 10000) limits the whole chain. An attempt past its limit counts as a failure and the next provider is tried; when the total is spent the request fails with 503 `SMS_DISPATCH_FAILED`. Invalid values fail at startup.
  - Providers receive an `AbortSignal` as an optional second argument to `send`, aborted at the attempt's limit. SES passes it to the AWS SDK, Gupshup to `fetch`; Twilio and Gupshup stop retrying once it aborts. A custom provider whose `send` takes one argument needs no change. One whose `send` already takes a second parameter of its own must rename or move it: TypeScript reports TS2416, and in JavaScript that parameter now receives `{ signal }`.
  - A request already in flight may still deliver after its limit. A fallback can then send a second message carrying the same code, and when every attempt times out the 503 may follow a message that did arrive, carrying a code for a verification that was removed.
  - Logged provider errors keep the AWS request id.

## 0.6.0

### Minor Changes

- **Security fix (GHSA-qm9j-mc5v-33p5):** `check()` answered `approved` for a verification that was already approved, without comparing the submitted code. A finished verification now answers `canceled`; only the call that approves reports `approved`. If removing the recipient index fails after an approval, the approving call still answers `approved` and the failure is logged. Upgrade from 0.5.0 and earlier.
  Email channel and an Amazon SES provider.

- New `email` module option (`provider`, `fallbacks`, `subject`, `template`) and an `EmailProvider` interface, plus `MockEmailProvider` for development and tests. `sms` is now optional; at least one of `sms` or `email` must be configured.
- Start a verification with `channel: 'email'` and an email address in `to`. `check` takes the address as before. The whole address is lowercased for cooldowns, rate limits and lookup, so case variants of one mailbox share them; the code is sent to the address as given. Addresses with display-name or list characters (`<>()[],;:"\`) are rejected.
- New package `@jadedm/nestjs-verify-ses`: `SesEmailProvider` sends through SES v2. It needs Node 20 or newer, as current AWS SDK releases do.
- New error codes `INVALID_EMAIL` and `CHANNEL_NOT_SUPPORTED`.
- Behaviour change: a channel with no configured provider is rejected with `CHANNEL_NOT_SUPPORTED`. Before, every channel was silently sent as SMS. This covers `voice` and `whatsapp` always, and `email` on a deployment that configures only `sms`.
- Logs, audit events and abuse records now name the provider that actually sent the code when a fallback succeeds; before, they named the primary. When every provider fails, the abuse record's `provider` is the comma-joined chain (`twilio,gupshup`).
- Store fields named `phone` hold the email address for email verifications. No schema change.
- Provider error messages have the recipient replaced with `[recipient]` before they reach logs, spans and the abuse store.
- Type change: `VerifyModuleOptions.sms` is now optional, so code that reads `options.sms.provider` from a typed options object needs a guard.
- Request validation: `to` now accepts an email address, and the validator's message for a malformed `to` changed to 'to must be an E.164 phone, e.g. +14155552671, or an email address'. A request with an email in `to` and no channel gets the service's `INVALID_PHONE` error instead of the validator's message.
- A failed email send returns `SMS_DISPATCH_FAILED`, the same code as SMS.
- Email sends are not recorded in `verify_sms_send_duration_seconds`; a channel-aware metric is tracked separately.
- When the cooldown or send record cannot be written after a send, the verification is removed and the caller gets `SMS_DISPATCH_FAILED` (503); before, the error escaped as a 500 with the verification left live.

## 0.5.0

### Minor Changes

- Observability release. Audit, tracing, and metrics. No wire-shape breaking changes; the store-interfaces gain one new optional field (`stores.audit`).

- New `AuditSink` interface in core, with three in-core implementations:
  - `MemoryAuditSink` for tests, captures events in an array.
  - `StdoutAuditSink` writes one JSON line per event.
  - `LoggerAuditSink` writes through Nest's Logger so events appear in whatever stream the host application configures.
- Lifecycle events emitted at every state transition: `verification_started`, `code_dispatched`, `verification_approved`, `verification_canceled`, `verification_expired`, `rate_limited`, `abuse_detected`. Each carries phone-redacted, ip, channel, provider, outcome, and arbitrary `meta`.
- `stores.audit` is optional; if absent, no events emit and no overhead is incurred. Sink failures are caught and logged at WARN level so a flaky sink never breaks a verification.

- OpenTelemetry tracing, auto-detect.

  - `@opentelemetry/api` is now a required peer dep (~3kb, no-op tracer at runtime if no SDK registered).
  - Spans at `verify.start`, `verify.check`, `verify.send_code` with attributes (`verify.phone_redacted`, `verify.channel`, `verify.sid`, `verify.provider`, `http.client_ip`). Exceptions recorded on the span, status set appropriately.
  - Service name configurable via `observability.tracing.serviceName`. Default tracker version auto-synced to the package version via a tsup build-time define.
  - All span names and attribute keys live in a `TELEMETRY` constants module for easy override.

- Prometheus metrics, opt-in.

  - `prom-client` is an optional peer dep. Required only when `observability.metrics.enabled: true`.
  - Metrics: `verify_starts_total`, `verify_starts_blocked_total{reason}`, `verify_checks_total{outcome}`, `verify_phone_rate_limit_hits_total`, histograms `verify_sms_send_duration_seconds{provider,outcome}` and `verify_check_duration_seconds`.
  - `VerifyService.getMetricsRegistry()` returns the prom-client Registry so adopters can wire it to their own `/metrics` controller.
  - Block reasons, check outcomes, and SMS outcomes exported as constants (`BLOCK_REASON`, `CHECK_OUTCOME`, `SMS_OUTCOME`) for type-safe label values.

- Other:
  - New `TELEMETRY` and `METRICS` constants modules. Span names, attribute keys, metric names, and label keys are no longer string literals scattered through the service.

## 0.4.0

### Minor Changes

- DX hardening release. No breaking changes from 0.3.0 on the wire or in the store interfaces.

- DTO validation:

  - `StartVerificationDto` and `CheckVerificationDto` now carry `class-validator` decorators. Wire `app.useGlobalPipes(new ValidationPipe({ transform: true }))` to surface validation errors with descriptive messages.
  - Service-layer phone regex check still runs as a safety net.

- OpenAPI / Swagger:

  - Added `@nestjs/swagger` as a peer dep.
  - New `VerifySwagger` const exported from core, following a per-feature `controllers/swagger/*.swagger.ts` convention. The built-in controller applies these decorators inline so adopters get a fully-documented `/verify/start` and `/verify/check` route in their Swagger UI for free.
  - DTOs carry `@ApiProperty` so the Swagger schemas render the right examples.

- Structured error catalog:

  - New `VerifyErrorCode` enum exports stable string codes (`COOLDOWN_ACTIVE`, `PHONE_RATE_LIMITED`, etc.). Clients can branch on `code` instead of message strings.
  - New `VerifyException` base class plus per-error subclasses (`InvalidPhoneException`, `CooldownActiveException`, `PhoneRateLimitedException`, `IpRateLimitedException`, `AbuseVelocityException`, `SmsDispatchFailedException`, `NoPendingVerificationException`, `CodeExpiredException`). Catch the base to handle all verify errors uniformly in a global filter.

- New utility:
  - `asyncHandler` exported from core. Go-style `[data, error]` tuple wrapper around any Promise. Used internally by the Gupshup provider and available to adopters.

## 0.3.0

### Minor Changes (BREAKING)

- Architectural unification of state stores. `@nestjs/cache-manager` and `cache-manager` are no longer peer dependencies. All state now lives behind five store interfaces in core, with one adapter per backend.

  New interfaces:

  - `RateLimitStore` with an atomic `hit(key, limit, windowSeconds)` returning `{ count, limit, exceeded, resetAt }`. Implementations MUST be atomic across instances when backed by a shared store.
  - `CooldownStore` with `remaining(key)` returning ms remaining and `start(key, seconds)`.
  - `PhoneIndexStore` with `set`, `get`, `delete` and a TTL.

  Module configuration shape change:

  - `stores.rateLimit`, `stores.cooldown`, `stores.phoneIndex` are now required.
  - `stores.abuse` remains optional.
  - `@nestjs/cache-manager`'s `CacheModule.register` no longer needs to be imported.

  Migration path: replace `CacheModule.register` and individual store constructors with a single factory call: `createMemoryStores()` for dev, `createPostgresStores({ connectionString })` for Postgres, `createMongoStores({ uri, databaseName })` for Mongo, or mix and match (Postgres durable + Redis ephemeral via `createRedisStores({ client: ioredis })`).

  Other changes in 0.3.0:

  - `package.json` now includes `"./package.json"` in the exports map so consumers can read the installed version programmatically.
  - The `fixedCode` boot warning no longer contains an emoji or em dash; renders cleanly across all log surfaces.
  - 14 new unit tests covering the three new memory stores.

## 0.2.0

### Minor Changes

- Release 0.2.0.

  Critical fixes for 0.1.0 (which shipped without working dependency injection):

  - Build now includes `@swc/core` so tsup emits `design:paramtypes` decorator metadata. NestJS dependency injection now resolves correctly. 0.1.0 was broken on install; 0.2.0 is the fix.
  - `@nestjs/common`, `@nestjs/core`, `@nestjs/cache-manager`, `cache-manager`, `reflect-metadata`, and `rxjs` are now marked external in tsup so they are never bundled. Prevents class-identity drift (e.g. `instanceof HttpException` returning false) when the consumer's peer version differs from the build-time copy.
  - Cooldown check now treats both `null` and `undefined` as a cache miss. Fixes a false-positive cooldown error under cache-manager v6 (Keyv-backed), which returns `null` for missing keys.

  API changes:

  - Renamed `StartResult.status` and `CheckResult.status` to `state` on the wire. Avoids collision with JSend-style envelope wrappers that use a top-level `status` field. Internal `VerificationRecord.status` is unchanged.

  New features:

  - New package `@jadedm/nestjs-verify-mongo` with `MongoVerifyStore` and `MongoAbuseStore`. Uses MongoDB aggregation pipeline updates for atomic attempt increment plus conditional lockout. TTL index for record expiry.
  - New export `MockSmsProvider` in core. Logs the message body via Nest's Logger at WARN level. Pair with `code.fixedCode` for fully predictable verifications in development and tests.
  - New config option `code.fixedCode`. When set, every verification uses this static code instead of a random one. Logs a warning at boot, escalates to error if `NODE_ENV === 'production'`.
  - New config option `logging.verbose`. When true, emits operational checkpoint logs at `log` level (start called, code dispatched, attempts incremented, lockout, etc.). When false, the same logs are emitted at `verbose` level and only surface if Nest's logger includes 'verbose'.

  Testing:

  - 9 new unit tests for `MemoryVerifyStore` covering the `incrementAttempts` contract, status transitions, and TTL semantics.
  - 5 new unit tests for `TwilioSmsProvider` covering transient (429/5xx) retry, terminal (4xx) no-retry, exhaustion of retry budget, and MessagingService SID detection.

  Docs:

  - Per-package READMEs added. Each ships with its npm tarball.
  - Root README rewritten with a state diagram, a comparison table against Twilio Verify, and a maturity section that catalogs gaps for the 1.0 milestone.

## 0.1.0

### Minor Changes

- d13fda2: Initial release. Self-hosted Twilio Verify-style OTP for NestJS with Twilio SMS provider and Postgres store.
