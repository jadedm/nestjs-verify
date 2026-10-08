---
"@jadedm/nestjs-verify-postgres": patch
---

README: the usage example now uses the real API. It called `ensureSchema()` and named `VERIFICATIONS_TABLE_DDL` and `ABUSE_TABLE_DDL`, none of which exist, and built two of the five required stores, so it did not compile. It now uses `createPostgresStores`, explains the migrations (advisory lock, `verify_schema_versions`, `skipSchemaSetup`, `MIGRATIONS`, `runMigrations`) and closing the returned pool, and notes that a store's `tableName` does not change what the migrations create. Documentation only.
