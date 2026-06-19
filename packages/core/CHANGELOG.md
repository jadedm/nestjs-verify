# @jadedm/nestjs-verify

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
