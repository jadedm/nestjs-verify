# @jadedm/nestjs-verify-twilio

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
