---
"@jadedm/nestjs-verify": patch
"@jadedm/nestjs-verify-postgres": patch
"@jadedm/nestjs-verify-mongo": patch
"@jadedm/nestjs-verify-redis": minor
---

An older start's stalled index write can no longer replace a newer verification's entry (#82). Before, the newer verification's correct code then answered `NO_PENDING_VERIFICATION`.

- `RecipientIndexStore.set` takes the record's `createdAt` as an optional fourth argument. The shipped stores refuse, atomically, to replace a live entry created later; an expired entry, an entry without `createdAt`, or a write without it is replaced as before.
- Postgres: migration 4 adds `verify_phone_index.created_at`. Upgrade every instance of the adapter together. With `skipSchemaSetup`, apply migration 4 from the exported `MIGRATIONS` first, or startup fails on the version check.
- Redis (breaking, hence a minor): index values are stored as `sid|createdAt` in the same key; `get` and `deleteIfMatches` read both forms. An older Redis adapter cannot read the new form, so deploy it to all instances at once.
- Mongo: an upsert that loses an insert race is retried, as a conditional update or, if the winning document is gone again, as another upsert, so the newest entry wins and no write is lost.
