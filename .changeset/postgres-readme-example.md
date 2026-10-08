---
"@jadedm/nestjs-verify-postgres": patch
---

README: the usage example now uses the real API. It called `ensureSchema()` and named `VERIFICATIONS_TABLE_DDL` and `ABUSE_TABLE_DDL`, none of which exist, and built only `verify` and the optional `abuse` store, missing three of the four required ones, so it did not compile. It now provides a `pg.Pool` as a Nest provider, closed on shutdown, and passes it to `createPostgresStores`; explains the migrations (advisory lock, `verify_schema_versions`, `skipSchemaSetup`, refusing a newer database, `MIGRATIONS`, `runMigrations`) and who owns which pool; and notes that a store's `tableName` does not change what the migrations create and must be a fixed identifier. Documentation only.
