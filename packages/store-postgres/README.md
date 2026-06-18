# @jadedm/nestjs-verify-postgres

Postgres store adapter for [`@jadedm/nestjs-verify`](https://www.npmjs.com/package/@jadedm/nestjs-verify). Provides the `VerifyStore` and `AbuseStore` implementations.

```bash
pnpm add @jadedm/nestjs-verify-postgres pg
```

## Usage

```ts
import { VerifyModule } from '@jadedm/nestjs-verify';
import {
  PostgresVerifyStore,
  PostgresAbuseStore,
} from '@jadedm/nestjs-verify-postgres';

VerifyModule.forRootAsync({
  useFactory: async () => {
    const verify = new PostgresVerifyStore({
      connectionString: process.env.DATABASE_URL!,
    });
    const abuse = new PostgresAbuseStore({
      connectionString: process.env.DATABASE_URL!,
    });
    await verify.ensureSchema();
    await abuse.ensureSchema();
    return {
      sms: { /* ... */ },
      stores: { verify, abuse },
    };
  },
});
```

`ensureSchema()` is idempotent and creates the required tables and indexes if they are not already present. You can also run the DDL yourself; see the exported `VERIFICATIONS_TABLE_DDL` and `ABUSE_TABLE_DDL` constants.

## Atomicity

`incrementAttempts` uses a single `UPDATE ... RETURNING` with a conditional `CASE` to increment the counter and conditionally transition the row to `canceled` when `max_attempts` is reached. One round trip, no race.

## Construction options

```ts
new PostgresVerifyStore({
  connectionString: 'postgres://...',
  // or
  poolConfig: { /* pg.PoolConfig */ },
  // or
  pool: existingPool,
  tableName: 'verifications',  // default
});
```

## Peers

- `@jadedm/nestjs-verify` 0.x
- `pg` 8.x

## Consulting

If you need a custom store adapter, schema migration help, or fractional CTO support shipping this into production, see [manishj.com](https://manishj.com).

## License

MIT. Manish Jadhav ([@jadedm](https://github.com/jadedm)).
