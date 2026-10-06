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

When any attempt may have been accepted by Twilio (HTTP 500, 502 or 504, a response that broke after its headers, or a network error other than those listed below), the thrown error carries `mayHaveSent: true`, even if a later attempt failed cleanly. `@jadedm/nestjs-verify` then starts the recipient's cooldown so an immediate retry does not send a second message. A refused connection, a DNS failure, an unreachable host or network, 429 and 503 are not marked; any other network error is marked, which errs toward a cooldown. The adapter's own retries still run after an uncertain attempt and can deliver the same code again (#43).

## Peers

- `@jadedm/nestjs-verify` 0.x
- `twilio` 4.x or 5.x

## Consulting

If you need a custom SMS provider adapter or fractional CTO support shipping this into production, see [manishj.com](https://manishj.com).

## License

MIT. Manish Jadhav ([@jadedm](https://github.com/jadedm)).
