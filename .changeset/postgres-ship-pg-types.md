---
"@jadedm/nestjs-verify-postgres": patch
---

The adapter now depends on `@types/pg`. Its type declarations use `pg`'s `Pool` and `PoolConfig`, and `pg` ships no types, so a strict TypeScript app had to install `@types/pg` itself or get TS7016 (with `skipLibCheck` on, those types were silently `any`). Nothing to install now; an app that already has `@types/pg` 8.x shares one copy.
