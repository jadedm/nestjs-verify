# @jadedm/nestjs-verify-postgres

## 0.6.11

### Patch Changes

- 52cbe06: `createPostgresStores` now ends the pool it created when startup fails, for example when the database's schema is newer than the package or `skipSchemaSetup` finds a version mismatch. Before, that pool was neither returned nor ended: its idle connection stayed open until pg's idle timeout (10 seconds by default) or, with `idleTimeoutMillis: 0` or a `min` pool size, until the process exited, and it kept the process alive meanwhile. A pool passed in as `pool` is never ended. The original error is still the one thrown.

## 0.6.10

### Patch Changes

- 661142c: README: the usage example now uses the real API. It called `ensureSchema()` and named `VERIFICATIONS_TABLE_DDL` and `ABUSE_TABLE_DDL`, none of which exist, and built only `verify` and the optional `abuse` store, missing three of the four required ones, so it did not compile. It now provides a `pg.Pool` as a Nest provider, closed on shutdown, and passes it to `createPostgresStores`; explains the migrations (advisory lock, `verify_schema_versions`, `skipSchemaSetup`, refusing a newer database, `MIGRATIONS`, `runMigrations`) and who owns which pool; and notes that a store's `tableName` does not change what the migrations create and must be a fixed identifier. Documentation only.

## 0.6.9

### Patch Changes

- 70ea822: The adapter now depends on `@types/pg`. Its type declarations use `pg`'s `Pool` and `PoolConfig`, and `pg` ships no types, so a strict TypeScript app had to install `@types/pg` itself or get TS7016 (with `skipLibCheck` on, those types were silently `any`). The adapter's own types now need nothing installed. The range is `^8.6.0`, every published 8.x, so an app that already has `@types/pg` 8.x shares one copy and its `Pool` stays assignable to the adapter's `pool` option. An app that imports from `pg` itself still installs `@types/pg` as usual.

## 0.6.0

### Minor Changes

- Version aligned with `@jadedm/nestjs-verify` 0.6.0; the peer range on core is now ^0.6.0. No changes to this package. Stores hold an email address in fields named `phone` for email verifications; no schema change.

## 0.5.0

### Minor Changes

- New `PostgresAuditSink` implementing the `AuditSink` interface added in `@jadedm/nestjs-verify` 0.5.0. Stores lifecycle events in a new `verify_audit_log` table with `JSONB` meta.
- Migration 002 creates `verify_audit_log` and three supporting indexes (`ts DESC`, `sid`, `(type, ts DESC)`). Runs automatically via the existing `runMigrations` runner under `pg_try_advisory_lock`.
- `createPostgresStores` factory now returns `audit` as part of the stores bundle. Wire it via `stores.audit` on `VerifyModule.forRoot`.

## 0.4.0

### Minor Changes

- Released alongside `@jadedm/nestjs-verify` 0.4.0 (DX hardening: class-validator DTOs, OpenAPI annotations, structured error code catalog, asyncHandler utility). No functional change in this package; version bumped to keep the linked group aligned.

## 0.3.0

### Minor Changes (BREAKING)

- Three new stores added to match the unified store architecture in core 0.3.0:
  - `PostgresRateLimitStore` with atomic counter-with-window via a single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`. No get-then-set race.
  - `PostgresCooldownStore` returning precise milliseconds remaining.
  - `PostgresPhoneIndexStore` replacing the old cache-backed lookup.
- New `createPostgresStores` factory returns all five stores plus a shared `pg.Pool` in one call. Replaces the per-store constructor pattern.
- New `runMigrations` runner with `pg_try_advisory_lock` for concurrent-instance safety. Each migration runs in a transaction and the version counter is tracked in a `verify_schema_versions` table. The previously exported `VERIFICATIONS_TABLE_DDL` and `ABUSE_TABLE_DDL` constants have been removed; the schema is now encoded in the exported `MIGRATIONS` array.
- `PostgresVerifyStore` and `PostgresAbuseStore` no longer expose `ensureSchema()`. Schema setup runs as part of the factory.

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
