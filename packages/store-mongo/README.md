# @jadedm/nestjs-verify-mongo

MongoDB store adapter for [`@jadedm/nestjs-verify`](https://www.npmjs.com/package/@jadedm/nestjs-verify). Provides all five stores (`VerifyStore`, `AbuseStore`, `RateLimitStore`, `CooldownStore`, `PhoneIndexStore`) and an audit sink, plus the schema migrations.

```bash
pnpm add @jadedm/nestjs-verify-mongo mongodb
```

## Usage

`createMongoStores` builds all five stores and the audit sink on one `Db` and runs the schema migrations (collections and TTL indexes) before returning:

```ts
import { VerifyModule } from '@jadedm/nestjs-verify';
import { createMongoStores } from '@jadedm/nestjs-verify-mongo';

VerifyModule.forRootAsync({
  useFactory: async () => {
    const { audit, close, ...stores } = await createMongoStores({
      uri: process.env.MONGO_URI!,
      databaseName: 'app',
    });
    return {
      sms: { /* ... */ },
      stores: { ...stores, audit },
    };
  },
});
```

When the factory opens its own client from `uri`, it returns `close()`; call it on shutdown. If you already have a MongoClient or a Mongoose connection, pass the `Db` instead (`createMongoStores({ db: existingDb })`); the client then stays yours to close. Migrations run under a lock document, so several instances starting at once take turns. With `skipSchemaSetup: true` the factory only checks the schema version.

The stores can also be built one at a time (see Construction options), for example to put the short-lived ones in Redis. The core requires `verify`, `rateLimit`, `cooldown` and `phoneIndex`; `abuse` (the velocity check) and `audit` are optional.

Mongoose users: `mongooseConnection.db` returns the underlying `Db`.

## Atomicity

`incrementAttempts` issues a single `findOneAndUpdate` with an aggregation pipeline update (Mongo 4.2+). The pipeline increments `attempts` and, in the same operation, conditionally flips `status` to `canceled` when `attempts` reaches `maxAttempts`. No race window between increment and lockout.

## TTL

The migrations create a TTL index on `expiresAt` (a store built on its own creates its indexes with `ensureIndexes()`). Mongo's TTL sweeper runs about once per minute, so expired records may exist for up to 60 seconds past `expiresAt`. Reads in the core library check `expiresAt` explicitly and treat stale records as expired.

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

- `@jadedm/nestjs-verify` within the range in `peerDependencies`
- `mongodb` 5.x or 6.x

Mongoose users can use this adapter directly. There is no separate `nestjs-verify-mongoose` package because Mongoose's `connection.db` exposes the same `Db` interface this adapter consumes.

## Help

If you need a custom store adapter, schema design help, or help shipping this into production, [Inoltro](https://inoltro.ai) is my studio.

## License

MIT. Manish Jadhav ([@jadedm](https://github.com/jadedm)).
