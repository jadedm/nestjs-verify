---
"@jadedm/nestjs-verify-postgres": patch
---

The adapter now depends on `@types/pg`. Its type declarations use `pg`'s `Pool` and `PoolConfig`, and `pg` ships no types, so a strict TypeScript app had to install `@types/pg` itself or get TS7016 (with `skipLibCheck` on, those types were silently `any`). The adapter's own types now need nothing installed. The range is `^8.6.0`, every published 8.x, so an app that already has `@types/pg` 8.x shares one copy and its `Pool` stays assignable to the adapter's `pool` option. An app that imports from `pg` itself still installs `@types/pg` as usual.
