---
"@jadedm/nestjs-verify-postgres": patch
---

`createPostgresStores` now ends the pool it created when startup fails, for example when the database's schema is newer than the package or `skipSchemaSetup` finds a version mismatch. Before, that pool was neither returned nor ended: its idle connection stayed open until pg's idle timeout (10 seconds by default) or, with `idleTimeoutMillis: 0` or a `min` pool size, until the process exited, and it kept the process alive meanwhile. A pool passed in as `pool` is never ended. The original error is still the one thrown.
