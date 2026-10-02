# @jadedm/nestjs-verify-ses

Amazon SES email provider for [`@jadedm/nestjs-verify`](https://www.npmjs.com/package/@jadedm/nestjs-verify). Sends verification codes by email through the SES v2 API.

```bash
pnpm add @jadedm/nestjs-verify-ses @aws-sdk/client-sesv2
```

## Usage

```ts
import { VerifyModule } from '@jadedm/nestjs-verify';
import { SesEmailProvider } from '@jadedm/nestjs-verify-ses';

VerifyModule.forRoot({
  email: {
    provider: new SesEmailProvider({
      from: 'Example <no-reply@example.com>', // a verified SES identity
      region: 'ap-south-1',
      configurationSetName: 'otp',            // optional
    }),
    subject: 'Your Example sign-in code',
  },
  stores: { /* ... */ },
});
```

Start a verification with `channel: 'email'` and an email address in `to`.

Credentials come from the AWS SDK's default chain (environment, shared config, instance or task role). Pass `client` to use your own `SESv2Client`.

## Errors and retries

The AWS SDK retries throttling and server errors itself (three attempts by default). Anything it gives up on, and any rejection such as an unverified identity or a recipient outside the sandbox, is thrown, so `nestjs-verify` moves on to the next provider in `email.fallbacks`.

## Requirements

Node 20 or newer: current `@aws-sdk/client-sesv2` releases require it, though the core package still supports Node 18.

## Peers

- `@jadedm/nestjs-verify` 0.x
- `@aws-sdk/client-sesv2` 3.x
