# @jadedm/nestjs-verify-gupshup

Gupshup SMS provider adapter for [`@jadedm/nestjs-verify`](https://www.npmjs.com/package/@jadedm/nestjs-verify). Useful for projects targeting the Indian and SEA SMS markets where Gupshup is widely deployed.

```bash
pnpm add @jadedm/nestjs-verify-gupshup
```

## Usage

```ts
import { VerifyModule } from '@jadedm/nestjs-verify';
import { GupshupSmsProvider } from '@jadedm/nestjs-verify-gupshup';

VerifyModule.forRoot({
  sms: {
    provider: new GupshupSmsProvider({
      auth: { mode: 'apikey', apiKey: process.env.GUPSHUP_API_KEY! },
      sender: process.env.GUPSHUP_SENDER!,
    }),
  },
  stores: createMemoryStores(),
});
```

## Auth modes

Gupshup accounts use one of two authentication shapes. The adapter accepts both:

```ts
// Newer accounts (recommended)
new GupshupSmsProvider({
  auth: { mode: 'apikey', apiKey: 'YOUR_API_KEY' },
  sender: 'JADEDM',
});

// Legacy accounts
new GupshupSmsProvider({
  auth: { mode: 'userpass', userid: 'YOUR_USERID', password: 'YOUR_PASSWORD' },
  sender: 'JADEDM',
});
```

`sender` is your DLT-approved sender id or short code.

## Retry behavior

Transient errors (HTTP 429, 5xx, or network failures) are retried with exponential backoff. The default budget is 2 retries on top of the initial attempt. Configure via `maxRetries` and `retryBaseMs`.

Terminal errors (HTTP 4xx, or a Gupshup in-body `error|...` response) surface immediately as `GupshupTerminalError` without retry.

After the retry budget is exhausted on persistent transient errors, the adapter throws `GupshupTransientError`. The verify service treats both as a failed dispatch and, unless the core's `delivery.fallbackAfterUncertain` is `false` and the failure was uncertain (below), tries the next provider in the fallback chain if one is configured.

When any attempt may have been accepted by Gupshup (HTTP 500, 502 or 504, a network error other than those listed below, or a response whose body could not be read), the thrown error carries `mayHaveSent: true`, even if a later attempt failed cleanly. `@jadedm/nestjs-verify` then starts the recipient's cooldown so an immediate retry does not send a second message. A refused connection, a DNS failure, an unreachable host or network, 429 and 503 are not marked; any other network error is marked, which errs toward a cooldown. The adapter's own retries still run after an uncertain attempt, so a retry can deliver the same code again. To stop that, pass `retryAfterUncertain: false`: an uncertain failure is then thrown at once, the core starts the cooldown, and the user retries after it. Failures known not to have sent (429, 503, refused connection, DNS) are retried either way. If `fallbacks` are configured, the core still tries the next provider after such a failure unless `delivery.fallbackAfterUncertain` is `false` in the core options.

## Fallback chain

Pair with another provider for resilience:

```ts
VerifyModule.forRoot({
  sms: {
    provider: new GupshupSmsProvider({ ... }),
    fallbacks: [new TwilioSmsProvider({ ... })],
  },
  stores: ...,
});
```

## Peers

- `@jadedm/nestjs-verify` 0.4.x

No SDK dependency. The adapter uses the global `fetch`. You can pass your own `fetchImpl` for tests or for environments that need a custom HTTP client.

## Consulting

If you need a custom SMS provider adapter, an India-market integration pattern, or fractional CTO support shipping this into production, see [manishj.com](https://manishj.com).

## License

MIT. Manish Jadhav ([@jadedm](https://github.com/jadedm)).
