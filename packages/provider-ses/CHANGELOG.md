# @jadedm/nestjs-verify-ses

## 0.7.0

### Patch Changes

- f22a978: Accepts `@jadedm/nestjs-verify` 0.7 as a peer (`>=0.6.8 <0.8.0`).

## 0.6.2

### Patch Changes

- eb3a762: Provider sends now have time limits. Before, a provider that never answered held `POST /verify/start` open indefinitely and the fallbacks were never tried.

  - New `delivery` option: `attemptTimeoutMs` (default 5000) limits one provider attempt, and `totalTimeoutMs` (default 10000) limits the whole chain. An attempt past its limit counts as a failure and the next provider is tried; when the total is spent the request fails with 503 `SMS_DISPATCH_FAILED`. Invalid values fail at startup.
  - Providers receive an `AbortSignal` as an optional second argument to `send`, aborted at the attempt's limit. SES passes it to the AWS SDK, Gupshup to `fetch`; Twilio and Gupshup stop retrying once it aborts. A custom provider whose `send` takes one argument needs no change. One whose `send` already takes a second parameter of its own must rename or move it: TypeScript reports TS2416, and in JavaScript that parameter now receives `{ signal }`.
  - A request already in flight may still deliver after its limit. A fallback can then send a second message carrying the same code, and when every attempt times out the 503 may follow a message that did arrive, carrying a code for a verification that was removed.
  - Logged provider errors keep the AWS request id.

- Updated dependencies [eb3a762]
  - @jadedm/nestjs-verify@0.6.2

## 0.6.0

### Minor Changes

- First version: `SesEmailProvider` sends verification codes through Amazon SES v2. Needs Node 20 or newer.
