---
"@jadedm/nestjs-verify-postgres": patch
---

`createPostgresStores` now ends the pool it created when startup fails, for example when the database's schema is newer than the package or `skipSchemaSetup` finds a version mismatch. Before, that pool was neither returned nor ended, so its connections stayed open until the process exited. A pool passed in as `pool` is never ended. The original error is still the one thrown.
