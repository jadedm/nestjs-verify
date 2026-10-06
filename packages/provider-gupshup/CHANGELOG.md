# @jadedm/nestjs-verify-gupshup

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
