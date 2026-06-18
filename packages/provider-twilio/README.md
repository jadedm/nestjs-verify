# @jadedm/nestjs-verify-twilio

Twilio SMS provider adapter for [`@jadedm/nestjs-verify`](https://www.npmjs.com/package/@jadedm/nestjs-verify).

```bash
pnpm add @jadedm/nestjs-verify-twilio twilio
```

## Usage

```ts
import { VerifyModule } from '@jadedm/nestjs-verify';
import { TwilioSmsProvider } from '@jadedm/nestjs-verify-twilio';

VerifyModule.forRoot({
  sms: {
    provider: new TwilioSmsProvider({
      accountSid:  process.env.TWILIO_ACCOUNT_SID!,
      authToken:   process.env.TWILIO_AUTH_TOKEN!,
      from:        process.env.TWILIO_FROM!,   // E.164 number OR Messaging Service SID (starts with "MG")
      maxRetries:  2,                          // optional, default 2
      retryBaseMs: 250,                        // optional, default 250
    }),
  },
  stores: { /* ... */ },
});
```

If `from` starts with `MG`, the adapter calls Twilio with `messagingServiceSid` instead of `from`.

## Retry behavior

Transient errors (HTTP 429 and 5xx) are retried with exponential backoff: `retryBaseMs * 2^attempt`. Default budget is two retries.

Terminal errors (invalid number, blocked recipient, geo permission, anything that is not 429/5xx) are not retried and are surfaced to the caller.

## Peers

- `@jadedm/nestjs-verify` 0.x
- `twilio` 4.x or 5.x

## Consulting

If you need a custom SMS provider adapter or fractional CTO support shipping this into production, see [manishj.com](https://manishj.com).

## License

MIT. Manish Jadhav ([@jadedm](https://github.com/jadedm)).
