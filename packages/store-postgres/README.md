# @jadedm/nestjs-verify-postgres

Postgres store adapter for [`@jadedm/nestjs-verify`](https://www.npmjs.com/package/@jadedm/nestjs-verify). Provides the `VerifyStore` and `AbuseStore` implementations.

```bash
pnpm add @jadedm/nestjs-verify-postgres pg
```

The adapter depends on `@types/pg` (any 8.x), so its own `Pool` and `PoolConfig` types need nothing else installed; an app that already has `@types/pg` 8.x shares that copy. If your own code imports from `pg` (for example to pass `pool: existingPool`), install `@types/pg` in your app as usual: pnpm does not let an app import a dependency it has not declared.

## Usage

`createPostgresStores` builds all five stores and the audit sink on one connection pool and runs the schema migrations before returning.

```ts
import { Module, OnApplicationShutdown } from '@nestjs/common';
import { VerifyModule } from '@jadedm/nestjs-verify';
import { createPostgresStores } from '@jadedm/nestjs-verify-postgres';
import type { Pool } from 'pg';

let pool: Pool | undefined;

@Module({
  imports: [
    VerifyModule.forRootAsync({
      useFactory: async () => {
        const stores = await createPostgresStores({ connectionString: process.env.DATABASE_URL! });
        pool = stores.pool;
        return {
          sms: { provider: yourSmsProvider }, // TwilioSmsProvider, GupshupSmsProvider or your own
          stores,
        };
      },
    }),
  ],
})
export class AppModule implements OnApplicationShutdown {
  async onApplicationShutdown() {
    await pool?.end();
  }
}
```

Pass `pool` instead of `connectionString` to share an existing `pg.Pool`, or `poolConfig` for full `pg` options. The returned object also carries `pool`, so the app can close it on shutdown as above.

## Schema and migrations

The first call to `createPostgresStores` creates the tables (`verifications`, `verify_abuse_log`, `verify_rate_limits`, `verify_cooldowns`, `verify_phone_index`, `verify_audit_log`) and records the applied version in `verify_schema_versions`. Later calls apply only what is missing, so restarts are cheap. Migrations run under a Postgres advisory lock, so several instances starting at once do not race, and each migration runs in a transaction.

To manage the schema yourself, pass `skipSchemaSetup: true`: no DDL runs, and startup fails if the database is not at the version this package expects. The SQL is exported as `MIGRATIONS`, and `runMigrations(pool)` applies it from your own tooling.

## Atomicity

`incrementAttempts` uses a single `UPDATE ... RETURNING` with a conditional `CASE` to increment the counter and conditionally transition the row to `canceled` when `max_attempts` is reached. One round trip, no race.

## Individual stores

Each store can be built on its own, for example to put the short-lived stores in Redis:

```ts
import { PostgresVerifyStore } from '@jadedm/nestjs-verify-postgres';

const verify = new PostgresVerifyStore({
  connectionString: 'postgres://...', // or poolConfig: { ... }, or pool: existingPool
  tableName: 'verifications',          // default
});
```

A store built this way runs no migrations; call `runMigrations(pool)` first. `tableName` changes only the queries, not what the migrations create, so a custom name needs a table you create from the `MIGRATIONS` SQL.

## Peers

- `@jadedm/nestjs-verify` 0.x
- `pg` 8.x

## Consulting

If you need a custom store adapter, schema migration help, or fractional CTO support shipping this into production, see [manishj.com](https://manishj.com).

## License

MIT. Manish Jadhav ([@jadedm](https://github.com/jadedm)).
