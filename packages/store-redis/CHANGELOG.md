# @jadedm/nestjs-verify-redis

## 0.7.1

### Patch Changes

- a2637d3: Accepts `@jadedm/nestjs-verify` 0.8 as a peer (`>=0.6.8 <0.9.0`).

## 0.7.0

### Minor Changes

- f22a978: Simultaneous starts for one recipient now send one code: the cooldown is claimed atomically before anything else, and the others get `COOLDOWN_ACTIVE` (#13).

  Breaking for custom stores: `CooldownStore` has two new required methods, `claim(key, seconds, holder)` and `release(key, holder)`. `VerifyService` refuses a cooldown store without them when it is constructed. The shipped memory, Postgres, Mongo and Redis stores implement both.

  Postgres: migration 3 adds a `holder` column to `verify_cooldowns`. With `skipSchemaSetup`, apply it before upgrading (it is in the exported `MIGRATIONS`); a custom `tableName` needs the same column. During a rolling upgrade, instances still on 0.6 do not clear `holder` when they start a cooldown, so a 0.7 instance releasing an earlier claim can end that cooldown; finish the rollout before relying on it.

  Behaviour: a refusal before the send (rate limit, abuse check, a store error) and a send that definitely failed leave no cooldown, as before, unless releasing the claim itself fails; the claim then blocks the recipient until it expires (the cooldown, or the send window plus 30 s if that is longer). When a message may have gone out and the cooldown write fails, the 503 now carries `retryAfterMs` for the claim still in force.

- db3c2f2: Cleaning up after one verification no longer removes the recipient's index entry when a newer verification has replaced it, so the newer code still checks (#9). This covers a failed send, a start that lost its cooldown claim, a failed index write, and `check` after an approval, a lockout or an expired code.

  Breaking for custom stores: `PhoneIndexStore` has a new required method, `deleteIfMatches(phone, sid)`, which removes the entry only while it maps `phone` to `sid`, atomically. `VerifyService` refuses a phone index store without it when it is constructed. The shipped stores implement it.

  The index entry now expires with its record rather than a full code TTL after the record was written. `check` now also removes the entry when it finds the record expired, locked out, already finished or missing, so a second `check` after any of those answers `NO_PENDING_VERIFICATION` instead of `canceled`, as it already did after an approval. A failed index cleanup after a lockout is logged rather than answered with a 500.

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

### Minor Changes

- Initial release. Implements the three ephemeral store interfaces from `@jadedm/nestjs-verify` 0.3.0 against Redis:
  - `RedisRateLimitStore` using a small Lua script for atomic `INCR` plus conditional `PEXPIRE`. Single round trip per hit, atomic across instances.
  - `RedisCooldownStore` using `SET key 1 EX seconds` and `PTTL` for remaining time.
  - `RedisPhoneIndexStore` using `SET ... EX`.
- Exports a small `RedisLike` interface so users on `node-redis` or other clients can adapt rather than being forced to install `ioredis`. `ioredis` is the primary peer dep.
- `createRedisStores({ client })` factory returns the three ephemeral stores wired with sensible default key prefixes.

This package does NOT implement `VerifyStore` or `AbuseStore`. Redis is volatile by default; pair it with `@jadedm/nestjs-verify-postgres` or `@jadedm/nestjs-verify-mongo` for durable storage.
