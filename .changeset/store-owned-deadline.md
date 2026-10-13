---
"@jadedm/nestjs-verify": patch
"@jadedm/nestjs-verify-postgres": patch
"@jadedm/nestjs-verify-mongo": patch
---

The store that judges a code's deadline also sets it (#108). Before, the app server's clock set `expiresAt` and the database's judged it, so steady skew between them made codes expire early or late by the skew.

- `VerifyStore.create(record, ttlSeconds?)`: given the TTL, a store sets the deadline from its own clock and returns it. Postgres stores `NOW() + ttl`; Mongo stores `$$NOW + ttl` and still refuses an existing sid. The start response's `expiresAt` is that deadline. A store that ignores the TTL keeps the record's `expiresAt`, as before.
- Core no longer compares `expiresAt` with its own clock before reserving an attempt; the store's `reserveAttempt` judges expiry on the clock that set it.
- The index entry's TTL is the code's TTL less the time the start has taken, measured on one clock.
- Mongo recipient index: written and read by the server's clock (`$$NOW`), the clock its TTL monitor uses.
- Custom stores: core's own expiry check is gone, so `reserveAttempt` must refuse an expired record, as the interface has required since 0.8.0.
