---
"@jadedm/nestjs-verify": minor
"@jadedm/nestjs-verify-postgres": minor
"@jadedm/nestjs-verify-mongo": minor
"@jadedm/nestjs-verify-redis": minor
---

Simultaneous starts for one recipient now send one code: the cooldown is claimed atomically before anything else, and the others get `COOLDOWN_ACTIVE` (#13).

Breaking for custom stores: `CooldownStore` has two new required methods, `claim(key, seconds, holder)` and `release(key, holder)`. `VerifyService` refuses a cooldown store without them when it is constructed. The shipped memory, Postgres, Mongo and Redis stores implement both.

Postgres: migration 3 adds a `holder` column to `verify_cooldowns`. With `skipSchemaSetup`, apply it before upgrading (it is in the exported `MIGRATIONS`); a custom `tableName` needs the same column. During a rolling upgrade, instances still on 0.6 do not clear `holder` when they start a cooldown, so a 0.7 instance releasing an earlier claim can end that cooldown; finish the rollout before relying on it.

Behaviour: a refusal before the send (rate limit, abuse check, a store error) and a send that definitely failed leave no cooldown, as before, unless releasing the claim itself fails; the claim then blocks the recipient until it expires (the cooldown, or the send window plus 30 s if that is longer). When a message may have gone out and the cooldown write fails, the 503 now carries `retryAfterMs` for the claim still in force.
