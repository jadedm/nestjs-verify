---
"@jadedm/nestjs-verify-postgres": patch
---

A failed migration now reports its own error even when the ROLLBACK or the advisory unlock also fails, and a client left in an unknown state is closed instead of returned to the pool. A dropped connection during migrations is reported as a startup error instead of crashing the process with an uncaught exception. With `skipSchemaSetup`, any error other than a missing version table (a refused connection, a wrong password, a missing permission) is reported as itself rather than as "database is at 0" (#69).
