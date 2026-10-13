# @jadedm/nestjs-verify-mongo

## 1.0.0

### Major Changes

- d94e459: 1.0.0. The public interface is frozen through 1.x: every exported interface, type, option, error code, metric name and store contract stays compatible, and a breaking change waits for 2.0 (#89).

  - Requirements: Node 22.12 or newer; `@nestjs/common` and `@nestjs/core` 11 or 12; `@nestjs/swagger` 11 or 12; `class-validator` 0.14 or 0.15; `rxjs` 7.1 or newer (#123).
  - Removed: everything 0.9 kept under its pre-0.9 name (phone-named options, fields, store methods, classes, the error-code and exception aliases), the deprecated metric series, span attribute, audit meta and log key, `MetricsRecorder.smsSendDuration` and `phoneRateLimitHits`, and `incrementAttempts` with `IncrementResult` (#124).
  - `stores.phoneIndex`, `rateLimit.perPhone` and `abuse.maxDistinctPhonesPerIp` are refused at boot, naming the 1.0 name.
  - `AbuseStore` requires only `recordSendAttempt` and `countDistinctRecipientsByIp`.
  - Every adapter accepts core `>=0.9.0 <2.0.0`.

  Upgrade to 0.9 and clear its deprecation warnings first. No database migration. See "Upgrading to 1.0.0" in the README.

## 0.8.2

### Patch Changes

- 9700d95: An older start's stalled index write can no longer replace a newer verification's entry (#82). Before, the newer verification's correct code then answered `NO_PENDING_VERIFICATION`.

  - `RecipientIndexStore.set` takes the record's `createdAt` as an optional fourth argument. The shipped stores refuse, atomically, to replace a live entry created later; an expired entry, an entry without `createdAt`, or a write without it is replaced as before.
  - Postgres: migration 4 adds `verify_phone_index.created_at`. Upgrade every instance of the adapter together. With `skipSchemaSetup`, apply migration 4 from the exported `MIGRATIONS` first, or startup fails on the version check.
  - Redis (breaking, hence a minor): index values are stored as `sid|createdAt` in the same key; `get` and `deleteIfMatches` read both forms. An older Redis adapter cannot read the new form, so deploy it to all instances at once.
  - Mongo: whether to replace the entry is decided inside one upsert on `_id`, which the server retries when two writes race to insert, so the newest entry wins and no write is lost.

- a29f8f7: Recipient-neutral names to match core 0.9 (#8), and core 0.9 is now in the supported peer range.

  - `PostgresPhoneIndexStore`, `MongoPhoneIndexStore` and `RedisPhoneIndexStore` are now `...RecipientIndexStore`. The old names remain as deprecated aliases until 1.0.
  - `create*Stores` returns the index as `recipientIndex`, and also as the deprecated `phoneIndex` (the same object).
  - Postgres and Mongo abuse stores add `countAttemptsByRecipient` and `countDistinctRecipientsByIp`. The old method names call them.
  - Verify, abuse and audit writes accept either the new field name or the old one, so a core before 0.9 keeps working. Reads return both. Tables, columns and Mongo fields are unchanged; no migration.

- 2046637: The store that judges a code's deadline also sets it (#108). Before, the app server's clock set `expiresAt` and the database's judged it, so steady skew between them made codes expire early or late by the skew.

  - `VerifyStore.create(record, ttlSeconds?)`: given the TTL, a store sets the deadline from its own clock and returns it. Postgres stores `NOW() + ttl`; Mongo stores `$$NOW + ttl` and still refuses an existing sid. The start response's `expiresAt` is that deadline. A store that ignores the TTL keeps the record's `expiresAt`, as before.
  - Core no longer compares `expiresAt` with its own clock before reserving an attempt; the store's `reserveAttempt` judges expiry on the clock that set it.
  - The index entry's TTL is the code's TTL less the time the start has taken, measured on one clock.
  - Mongo recipient index: written and read by the server's clock (`$$NOW`), the clock its TTL monitor uses.
  - Custom stores: core's own expiry check is gone, so `reserveAttempt` must refuse an expired record, as the interface has required since 0.8.0.

## 0.8.1

### Patch Changes

- feccf77: `check` no longer answers `pending` for a wrong code when it can see that another check approved or cancelled the verification while this one was comparing; it answers `canceled`. A check of a finished verification is now counted under the `no_pending` metric outcome. The Postgres and Mongo stores now report why a reservation was refused (expired, or attempts spent) by the database clock that refused it, rather than the server's clock, which could disagree.

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

### Patch Changes

- ad99c69: The Mongo stores now work with `mongodb` driver 5, which their peer range accepts (#79). Under driver 5 the rate limiter threw on every hit, failed attempts never reported a lockout, and the migration lock never made a second instance wait, because driver 5's `findOneAndUpdate` returns a result object where driver 6 returns the document. CI now runs the Mongo smoke under drivers 5 and 6.

## 0.6.0

### Minor Changes

- Version aligned with `@jadedm/nestjs-verify` 0.6.0; the peer range on core is now ^0.6.0. No changes to this package. Stores hold an email address in fields named `phone` for email verifications; no schema change.

## 0.5.0

### Minor Changes

- New `MongoAuditSink` implementing the `AuditSink` interface added in `@jadedm/nestjs-verify` 0.5.0. Stores lifecycle events in a new `verify_audit_log` collection.
- Migration 002 creates the collection with a 90-day TTL index on `ts`, plus single-field indexes on `sid` and `(type, ts DESC)`. Runs automatically via the existing sentinel-locked runner.
- `createMongoStores` factory now returns `audit` as part of the stores bundle.

## 0.4.0

### Minor Changes

- Released alongside `@jadedm/nestjs-verify` 0.4.0 (DX hardening: class-validator DTOs, OpenAPI annotations, structured error code catalog, asyncHandler utility). No functional change in this package; version bumped to keep the linked group aligned.

## 0.3.0

### Minor Changes (BREAKING)

- Three new stores added to match the unified store architecture in core 0.3.0:
  - `MongoRateLimitStore` with atomic counter-with-window via `findOneAndUpdate` plus an aggregation-pipeline update.
  - `MongoCooldownStore` returning precise milliseconds remaining.
  - `MongoPhoneIndexStore`.
- New `createMongoStores` factory returns all five stores plus an optional `close()` helper for owned clients.
- New `runMongoMigrations` runner using a sentinel document with `lockUntil` for concurrent-instance safety. Tracks version in a `verify_schema_versions` collection.
- `MongoVerifyStore` and `MongoAbuseStore` no longer require a separate `ensureIndexes()` call. Index setup runs as part of the factory. The runner creates TTL indexes on `expiresAt` and `resetAt` for all three new collections.

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
