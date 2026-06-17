# @jadedm/nestjs-verify

Self-hosted, Twilio-Verify-style OTP for NestJS. Bring your own SMS provider.

A POST starts a verification, another POST checks the code. The library owns
code generation, TTL, attempt caps, cooldowns, rate limits, and abuse heuristics.
You pick the provider (Twilio, MessageBird, AWS SNS, …) and the store
(Postgres, Mongo, in-memory, …).

## Packages

| Package | Purpose |
|---|---|
| [`@jadedm/nestjs-verify`](./packages/core) | Core module, service, interfaces, code-gen, cache-manager TTL state |
| [`@jadedm/nestjs-verify-twilio`](./packages/provider-twilio) | Twilio SMS provider adapter |
| [`@jadedm/nestjs-verify-postgres`](./packages/store-postgres) | Postgres durable store (verifications + abuse log) |

## Quickstart

```bash
pnpm add @jadedm/nestjs-verify @jadedm/nestjs-verify-twilio @jadedm/nestjs-verify-postgres
```

```ts
import { VerifyModule } from '@jadedm/nestjs-verify';
import { TwilioSmsProvider } from '@jadedm/nestjs-verify-twilio';
import { PostgresVerifyStore, PostgresAbuseStore } from '@jadedm/nestjs-verify-postgres';
import { CacheModule } from '@nestjs/cache-manager';

@Module({
  imports: [
    CacheModule.register({ isGlobal: true }),
    VerifyModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c) => ({
        sms: { provider: new TwilioSmsProvider({
          accountSid: c.get('TWILIO_ACCOUNT_SID')!,
          authToken:  c.get('TWILIO_AUTH_TOKEN')!,
          from:       c.get('TWILIO_FROM_NUMBER')!,
        })},
        stores: {
          verify: new PostgresVerifyStore({ connectionString: c.get('DATABASE_URL')! }),
          abuse:  new PostgresAbuseStore({ connectionString: c.get('DATABASE_URL')! }),
        },
        code:        { length: 6, ttlSeconds: 600 },
        attempts:    { max: 5, cooldownSeconds: 30 },
        rateLimit:   { perPhone: { count: 5, windowSeconds: 3600 } },
      }),
    }),
  ],
})
export class AppModule {}
```

A controller is exposed at `/verify/start` and `/verify/check` out of the box.

## Why

Twilio Verify costs ~$0.05 per verification on top of SMS. At scale that's
real money — and your OTP state lives inside their tenant. This library gives
you the same surface area on infrastructure you already run, with provider
choice.

## License

MIT
