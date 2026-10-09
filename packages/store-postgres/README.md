# @jadedm/nestjs-verify-postgres

Postgres store adapter for [`@jadedm/nestjs-verify`](https://www.npmjs.com/package/@jadedm/nestjs-verify). Provides all five stores (`VerifyStore`, `AbuseStore`, `RateLimitStore`, `CooldownStore`, `PhoneIndexStore`) and an audit sink, plus the schema migrations.

```bash
pnpm add @jadedm/nestjs-verify-postgres pg
```

The adapter depends on `@types/pg` (any 8.x), so its own `Pool` and `PoolConfig` types need nothing else installed; an app that already has `@types/pg` 8.x shares that copy. If your own code imports from `pg` (for example to pass `pool: existingPool`), install `@types/pg` in your app as usual: pnpm does not let an app import a dependency it has not declared.

## Usage

`createPostgresStores` builds all five stores and the audit sink on one connection pool and runs the schema migrations before returning. Give the pool to Nest as a provider, so each app instance owns one pool and closes it on shutdown:

```ts
import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { VerifyModule } from '@jadedm/nestjs-verify';
import { createPostgresStores } from '@jadedm/nestjs-verify-postgres';
import { Pool } from 'pg';

export const PG_POOL = Symbol('PG_POOL');

@Module({
  providers: [{ provide: PG_POOL, useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL }) }],
  exports: [PG_POOL],
})
export class PgModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}

@Module({
  imports: [
    VerifyModule.forRootAsync({
      imports: [PgModule],
      inject: [PG_POOL],
      useFactory: async (pool: Pool) => ({
        sms: { provider: yourSmsProvider }, // TwilioSmsProvider, GupshupSmsProvider or your own
        stores: await createPostgresStores({ pool }),
      }),
    }),
  ],
})
export class AppModule {}
```

Your app imports `pg` here, so it installs `@types/pg` too. Nest runs `onApplicationShutdown` on `app.close()`; to also run it on SIGTERM or SIGINT, call `app.enableShutdownHooks()` in `main.ts`.

`createPostgresStores` also accepts `connectionString` or `poolConfig` instead of `pool`. It then creates the pool itself and returns it as `pool` on the result; that pool is yours to end on shutdown. A pool you passed in stays yours: the stores never end it.

## Schema and migrations

The first call to `createPostgresStores` creates the tables (`verifications`, `verify_abuse_log`, `verify_rate_limits`, `verify_cooldowns`, `verify_phone_index`, `verify_audit_log`) and records the applied version in `verify_schema_versions`. Later calls apply only what is missing, so restarts are cheap. Migrations run under a Postgres advisory lock, so several instances starting at once wait for each other instead of racing, and each migration runs in a transaction. Startup also refuses a database whose recorded version is newer than this package knows, for example after rolling the package back.

To manage the schema yourself, pass `skipSchemaSetup: true`: no DDL runs, and startup fails if the database is not at the version this package expects. The SQL is exported as `MIGRATIONS`, and `runMigrations(pool)` applies it from your own tooling. Version 3 (0.7.0) adds a `holder` column to `verify_cooldowns`; a store given a custom `tableName` needs it too.

## Atomicity

`incrementAttempts` uses a single `UPDATE ... RETURNING` with a conditional `CASE` to increment the counter and conditionally transition the row to `canceled` when `max_attempts` is reached. One round trip, no race.

## Individual stores

Each store can be built on its own, for example to put the short-lived stores in Redis. Build one `pg.Pool`, run the migrations on it, and pass it to every Postgres store:

```ts
import { PostgresAbuseStore, PostgresVerifyStore, runMigrations } from '@jadedm/nestjs-verify-postgres';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await runMigrations(pool);
const verify = new PostgresVerifyStore({ pool });
const abuse = new PostgresAbuseStore({ pool });
```

A store given `connectionString` or `poolConfig` instead creates a private pool of its own, which nothing can close, so prefer `pool`.

Each store also accepts `tableName`. It changes only the queries, not what the migrations create, and the migrations' version check does not track a renamed table: you create it yourself by copying the `MIGRATIONS` SQL with the name changed. `tableName` is placed in the SQL as written, so it must be a fixed identifier from your code, never user input.

## Peers

- `@jadedm/nestjs-verify` within the range in `peerDependencies`
- `pg` 8.x

## Help

If you need a custom store adapter, schema migration help, or help shipping this into production, [Inoltro](https://inoltro.ai) is my studio.

## License

MIT. Manish Jadhav ([@jadedm](https://github.com/jadedm)).
