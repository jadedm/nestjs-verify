# @jadedm/nestjs-verify-twilio

## 0.6.6

### Patch Changes

- c2b3b56: New provider option `retryAfterUncertain` (Twilio and Gupshup), default `true`, which keeps today's behaviour. Both providers retry a 500, 502, 504 or a network failure inside one send; when the failed attempt may already have been accepted, a retry can deliver the same code a second time. With `retryAfterUncertain: false`, such a failure is thrown at once, marked `mayHaveSent`, so the core starts the cooldown and the user retries after it. Failures known not to have sent (429, 503, a refused connection, a DNS failure) are still retried. The option does not stop the core trying the next provider in `fallbacks` (#51). Also fixed: a frozen Twilio error is now wrapped so the may-have-sent mark is not lost, and a Gupshup request aborted by the core now rejects with the abort reason instead of a provider error. The core change is documentation only.
- Updated dependencies [c2b3b56]
  - @jadedm/nestjs-verify@0.6.6

## 0.6.5

### Patch Changes

- 852a54d: A provider error can now say the request may have been accepted, and the core treats it like a timeout: it starts the recipient's cooldown before answering 503, and the 503 carries `retryAfterMs`. Before, an error from a provider was always taken as "nothing sent", so after a 504 or a dropped connection the user's immediate retry could send a second message. Twilio's and Gupshup's own internal retries still run after such a failure and can deliver the same code again (#43).

  - Core: an error with `mayHaveSent: true` (exactly `true`) counts as possibly delivered, including after the recipient scrub that rebuilds provider errors.
  - Twilio and Gupshup set `mayHaveSent: true` on the error they throw when any attempt got HTTP 500, 502 or 504, a response that broke after its headers, or a network error other than a refused connection, DNS failure, unreachable host or network, or (Gupshup) connect timeout. 429 and 503 are not marked. Unknown network errors are marked, which errs toward a cooldown. The property is plain, so these providers still work with older core versions, which ignore it.

- Updated dependencies [852a54d]
  - @jadedm/nestjs-verify@0.6.5

## 0.6.2

### Patch Changes

- eb3a762: Provider sends now have time limits. Before, a provider that never answered held `POST /verify/start` open indefinitely and the fallbacks were never tried.

  - New `delivery` option: `attemptTimeoutMs` (default 5000) limits one provider attempt, and `totalTimeoutMs` (default 10000) limits the whole chain. An attempt past its limit counts as a failure and the next provider is tried; when the total is spent the request fails with 503 `SMS_DISPATCH_FAILED`. Invalid values fail at startup.
  - Providers receive an `AbortSignal` as an optional second argument to `send`, aborted at the attempt's limit. SES passes it to the AWS SDK, Gupshup to `fetch`; Twilio and Gupshup stop retrying once it aborts. A custom provider whose `send` takes one argument needs no change. One whose `send` already takes a second parameter of its own must rename or move it: TypeScript reports TS2416, and in JavaScript that parameter now receives `{ signal }`.
  - A request already in flight may still deliver after its limit. A fallback can then send a second message carrying the same code, and when every attempt times out the 503 may follow a message that did arrive, carrying a code for a verification that was removed.
  - Logged provider errors keep the AWS request id.

- Updated dependencies [eb3a762]
  - @jadedm/nestjs-verify@0.6.2

## 0.6.1

### Patch Changes

- f0ff0dc: The provider now loads in ES module apps. Before, importing it from ESM failed at startup with "Named export 'Twilio' not found", on every supported twilio version, because `twilio` is a CommonJS package. CommonJS apps were not affected.

## 0.6.0

### Minor Changes

- Version aligned with `@jadedm/nestjs-verify` 0.6.0; the peer range on core is now ^0.6.0. No changes to this package. Stores hold an email address in fields named `phone` for email verifications; no schema change.

## 0.5.0

### Minor Changes

- Released alongside `@jadedm/nestjs-verify` 0.5.0 (observability: AuditSink interface + Logger/Stdout/Memory sinks; OpenTelemetry tracing on verify.start, verify.check, verify.send_code; Prometheus metrics opt-in via prom-client). No functional change in this package; version bumped to keep the linked group aligned.

## 0.4.0

### Minor Changes

- Released alongside `@jadedm/nestjs-verify` 0.4.0 (DX hardening: class-validator DTOs, OpenAPI annotations, structured error code catalog, asyncHandler utility). No functional change in this package; version bumped to keep the linked group aligned.

## 0.3.0

### Minor Changes (BREAKING)

- Released alongside `@jadedm/nestjs-verify` 0.3.0, which dropped `@nestjs/cache-manager` and introduced three new store interfaces (`RateLimitStore`, `CooldownStore`, `PhoneIndexStore`). This package is unchanged in code but its peer range now points at core 0.3.x and the version was bumped to keep the linked group aligned.

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

### Patch Changes

- Updated dependencies
  - @jadedm/nestjs-verify@0.2.0

## 0.1.0

### Minor Changes

- d13fda2: Initial release. Self-hosted Twilio Verify-style OTP for NestJS with Twilio SMS provider and Postgres store.

### Patch Changes

- Updated dependencies [d13fda2]
  - @jadedm/nestjs-verify@0.1.0
