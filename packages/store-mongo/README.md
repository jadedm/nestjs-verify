# @jadedm/nestjs-verify-mongo

MongoDB store adapter for [`@jadedm/nestjs-verify`](https://www.npmjs.com/package/@jadedm/nestjs-verify). Provides the `VerifyStore` and `AbuseStore` implementations.

```bash
pnpm add @jadedm/nestjs-verify-mongo mongodb
```

## Usage

```ts
import { VerifyModule } from '@jadedm/nestjs-verify';
import { MongoVerifyStore, MongoAbuseStore } from '@jadedm/nestjs-verify-mongo';

VerifyModule.forRootAsync({
  useFactory: async () => {
    const verify = new MongoVerifyStore({
      uri: process.env.MONGO_URI!,
      databaseName: 'app',
    });
    const abuse = new MongoAbuseStore({
      uri: process.env.MONGO_URI!,
      databaseName: 'app',
    });
    await verify.ensureIndexes();
    await abuse.ensureIndexes();
    return {
      sms: { /* ... */ },
      stores: { verify, abuse },
    };
  },
});
```

If you already have a MongoClient or a Mongoose connection, pass the `Db` directly instead of a connection string:

```ts
new MongoVerifyStore({ db: existingDb });
```

Mongoose users: `mongooseConnection.db` returns the underlying `Db`.

## Atomicity

`incrementAttempts` issues a single `findOneAndUpdate` with an aggregation pipeline update (Mongo 4.2+). The pipeline increments `attempts` and, in the same operation, conditionally flips `status` to `canceled` when `attempts` reaches `maxAttempts`. No race window between increment and lockout.

## TTL

`ensureIndexes()` creates a TTL index on `expiresAt`. Mongo's TTL sweeper runs about once per minute, so expired records may exist for up to 60 seconds past `expiresAt`. Reads in the core library check `expiresAt` explicitly and treat stale records as expired.

## Construction options

```ts
new MongoVerifyStore({
  uri:           'mongodb://...',     // creates a client
  databaseName:  'app',
  clientOptions: { /* MongoClientOptions */ },
  // or
  db: existingDb,                     // bring your own Db
  collectionName: 'verifications',    // default
});

new MongoAbuseStore({
  // ...same connection options...
  collectionName:    'verify_abuse_log',   // default
  retentionSeconds:  60 * 60 * 24 * 7,     // default 7 days, TTL index
});
```

## Peers

- `@jadedm/nestjs-verify` 0.x
- `mongodb` 5.x or 6.x

Mongoose users can use this adapter directly. There is no separate `nestjs-verify-mongoose` package because Mongoose's `connection.db` exposes the same `Db` interface this adapter consumes.

## Consulting

If you need a custom store adapter, schema design help, or fractional CTO support shipping this into production, see [manishj.com](https://manishj.com).

## License

MIT. Manish Jadhav ([@jadedm](https://github.com/jadedm)).
