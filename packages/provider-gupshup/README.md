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

After the retry budget is exhausted on persistent transient errors, the adapter throws `GupshupTransientError`. The verify service treats both as a failed dispatch and tries the next provider in the fallback chain if one is configured.

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
