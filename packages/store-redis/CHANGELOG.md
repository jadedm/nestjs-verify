# @jadedm/nestjs-verify-redis

## 0.3.0

### Minor Changes

- Initial release. Implements the three ephemeral store interfaces from `@jadedm/nestjs-verify` 0.3.0 against Redis:
  - `RedisRateLimitStore` using a small Lua script for atomic `INCR` plus conditional `PEXPIRE`. Single round trip per hit, atomic across instances.
  - `RedisCooldownStore` using `SET key 1 EX seconds` and `PTTL` for remaining time.
  - `RedisPhoneIndexStore` using `SET ... EX`.
- Exports a small `RedisLike` interface so users on `node-redis` or other clients can adapt rather than being forced to install `ioredis`. `ioredis` is the primary peer dep.
- `createRedisStores({ client })` factory returns the three ephemeral stores wired with sensible default key prefixes.

This package does NOT implement `VerifyStore` or `AbuseStore`. Redis is volatile by default; pair it with `@jadedm/nestjs-verify-postgres` or `@jadedm/nestjs-verify-mongo` for durable storage.
