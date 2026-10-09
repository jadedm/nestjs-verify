# @jadedm/nestjs-verify-gupshup

## 0.6.6

### Patch Changes

- a2637d3: Accepts `@jadedm/nestjs-verify` 0.8 as a peer (`>=0.6.8 <0.9.0`).

## 0.6.5

### Patch Changes

- f22a978: Accepts `@jadedm/nestjs-verify` 0.7 as a peer (`>=0.6.8 <0.8.0`).

## 0.6.4

### Patch Changes

- 85a3dfd: New core option `delivery.fallbackAfterUncertain`, default `true`, which keeps today's behaviour. After a provider attempt that may have been accepted (it timed out, or its error carries `mayHaveSent: true`), the core tries the next provider in `fallbacks`, and that provider can send the same code a second time. With `fallbackAfterUncertain: false`, the chain stops there: the cooldown starts and `POST /verify/start` answers 503, with `retryAfterMs` when the cooldown write succeeds. An attempt that failed outright still moves on to the next provider. A non-boolean value fails at startup. A start sends at most once only when every provider in the chain marks uncertain failures and does not retry after them, such as Twilio and Gupshup with `retryAfterUncertain: false`; SES and unmarked custom providers do not qualify. Twilio and Gupshup: documentation only.
- Updated dependencies [85a3dfd]
  - @jadedm/nestjs-verify@0.6.7

## 0.6.3

### Patch Changes

- c2b3b56: New provider option `retryAfterUncertain` (Twilio and Gupshup), default `true`, which keeps today's behaviour. Both providers retry a 500, 502, 504 or a network failure inside one send; when the failed attempt may already have been accepted, a retry can deliver the same code a second time. With `retryAfterUncertain: false`, such a failure is thrown at once, marked `mayHaveSent`, so the core starts the cooldown and the user retries after it. Failures known not to have sent (429, 503, a refused connection, a DNS failure) are still retried. The option does not stop the core trying the next provider in `fallbacks` (#51). Also fixed: a frozen Twilio error is now wrapped so the may-have-sent mark is not lost, and a Gupshup request aborted by the core now rejects with the abort reason instead of a provider error. The core change is documentation only.
- Updated dependencies [c2b3b56]
  - @jadedm/nestjs-verify@0.6.6

## 0.6.2

### Patch Changes

- 852a54d: A provider error can now say the request may have been accepted, and the core treats it like a timeout: it starts the recipient's cooldown before answering 503, and the 503 carries `retryAfterMs`. Before, an error from a provider was always taken as "nothing sent", so after a 504 or a dropped connection the user's immediate retry could send a second message. Twilio's and Gupshup's own internal retries still run after such a failure and can deliver the same code again (#43).

  - Core: an error with `mayHaveSent: true` (exactly `true`) counts as possibly delivered, including after the recipient scrub that rebuilds provider errors.
  - Twilio and Gupshup set `mayHaveSent: true` on the error they throw when any attempt got HTTP 500, 502 or 504, a response that broke after its headers, or a network error other than a refused connection, DNS failure, unreachable host or network, or (Gupshup) connect timeout. 429 and 503 are not marked. Unknown network errors are marked, which errs toward a cooldown. The property is plain, so these providers still work with older core versions, which ignore it.

- Updated dependencies [852a54d]
  - @jadedm/nestjs-verify@0.6.5

## 0.6.1

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

- Version aligned with `@jadedm/nestjs-verify` 0.6.0; the peer range on core is now ^0.6.0. No changes to this package. Stores hold an email address in fields named `phone` for email verifications; no schema change.

## 0.5.0

### Minor Changes

- Released alongside `@jadedm/nestjs-verify` 0.5.0 (observability: AuditSink interface + Logger/Stdout/Memory sinks; OpenTelemetry tracing on verify.start, verify.check, verify.send_code; Prometheus metrics opt-in via prom-client). No functional change in this package; version bumped to keep the linked group aligned.

## 0.4.0

### Minor Changes

- Initial release. Gupshup SMS provider adapter for `@jadedm/nestjs-verify`. Implements the `SmsProvider` interface against the Gupshup enterprise API.
- Supports both auth modes: `userpass` (legacy) and `apikey` (current).
- Transient error retry with exponential backoff (HTTP 429/5xx and network errors).
- Terminal errors (HTTP 4xx and in-body `error|...` responses) surface immediately without retry.
- Uses internal `AUTH_MAPPERS` lookup and the core `asyncHandler` utility, matching the @jadedm style preference for declarative branching over if/else trees and tuple returns over try/catch.
- 10 unit tests cover the auth mapper, classify+retry path, network errors, and the Gupshup response parser.
