# @jadedm/nestjs-verify

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
