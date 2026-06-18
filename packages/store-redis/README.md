# @jadedm/nestjs-verify-redis

Redis adapter for the ephemeral stores in [`@jadedm/nestjs-verify`](https://www.npmjs.com/package/@jadedm/nestjs-verify): rate limit, cooldown, phone index. Pair with `@jadedm/nestjs-verify-postgres` or `@jadedm/nestjs-verify-mongo` for the durable stores.

```bash
pnpm add @jadedm/nestjs-verify-redis ioredis
```

## Usage

```ts
import Redis from 'ioredis';
import { createRedisStores } from '@jadedm/nestjs-verify-redis';

const redis = new Redis(process.env.REDIS_URL!);
const { rateLimit, cooldown, phoneIndex } = createRedisStores({ client: redis });

VerifyModule.forRoot({
  sms: { provider: ... },
  stores: {
    verify:     pgVerify,    // durable, from -postgres or -mongo
    abuse:      pgAbuse,     // durable, optional
    rateLimit,
    cooldown,
    phoneIndex,
  },
});
```

## Why Redis here

The three ephemeral stores are the hot path. Rate limit hits run on every `/verify/start` and `/verify/check`. Redis's `INCR` plus `PEXPIRE` (run from a single Lua script for atomicity) outperforms a Postgres `UPSERT` by an order of magnitude on this workload. If you already run Redis for caching or sessions, plug it in here.

## Why no VerifyStore or AbuseStore

Redis without persistence is volatile. Losing in-flight verifications to a Redis restart is unacceptable. Losing rate-limit counters is fine (the worst case is a few extra requests in the first second after restart). The split is deliberate.

If you really want Redis-only with AOF persistence enabled, you can implement `VerifyStore` and `AbuseStore` yourself in your application code and ship a PR for a `RedisVerifyStore` if there is demand.

## The RedisLike interface

For users not on `ioredis`, this package exports a small `RedisLike` interface:

```ts
import type { RedisLike } from '@jadedm/nestjs-verify-redis';
```

Any object that implements `get`, `set` (variadic), `del`, `pttl`, and `eval` matching the documented shapes will work. `ioredis` matches it natively. `node-redis` users can wrap their client with a small shim.

## Peers

- `@jadedm/nestjs-verify` 0.3.x
- `ioredis` 5.x (optional peer; required only if you pass an `ioredis` instance directly)

## Consulting

If you need a custom adapter, integration help, or fractional CTO support shipping this into production, see [manishj.com](https://manishj.com).

## License

MIT. Manish Jadhav ([@jadedm](https://github.com/jadedm)).
