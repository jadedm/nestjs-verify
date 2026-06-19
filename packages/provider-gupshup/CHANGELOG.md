# @jadedm/nestjs-verify-gupshup

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
