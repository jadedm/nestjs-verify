---
"@jadedm/nestjs-verify-postgres": patch
"@jadedm/nestjs-verify-mongo": patch
"@jadedm/nestjs-verify-redis": patch
---

Recipient-neutral names to match core 0.9 (#8), and core 0.9 is now in the supported peer range.

- `PostgresPhoneIndexStore`, `MongoPhoneIndexStore` and `RedisPhoneIndexStore` are now `...RecipientIndexStore`. The old names remain as deprecated aliases until 1.0.
- `create*Stores` returns the index as `recipientIndex`, and also as the deprecated `phoneIndex` (the same object).
- Postgres and Mongo abuse stores add `countAttemptsByRecipient` and `countDistinctRecipientsByIp`. The old method names call them.
- Verify, abuse and audit writes accept either the new field name or the old one, so a core before 0.9 keeps working. Reads return both. Tables, columns and Mongo fields are unchanged; no migration.
