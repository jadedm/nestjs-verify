---
"@jadedm/nestjs-verify": major
"@jadedm/nestjs-verify-twilio": major
"@jadedm/nestjs-verify-ses": major
"@jadedm/nestjs-verify-gupshup": major
"@jadedm/nestjs-verify-postgres": major
"@jadedm/nestjs-verify-mongo": major
"@jadedm/nestjs-verify-redis": major
---

1.0.0. The public interface is frozen through 1.x: every exported interface, type, option, error code, metric name and store contract stays compatible, and a breaking change waits for 2.0 (#89).

- Requirements: Node 22.12 or newer; `@nestjs/common` and `@nestjs/core` 11 or 12; `@nestjs/swagger` 11 or 12; `class-validator` 0.14 or 0.15; `rxjs` 7.1 or newer (#123).
- Removed: everything 0.9 kept under its pre-0.9 name (phone-named options, fields, store methods, classes, the error-code and exception aliases), the deprecated metric series, span attribute, audit meta and log key, `MetricsRecorder.smsSendDuration` and `phoneRateLimitHits`, and `incrementAttempts` with `IncrementResult` (#124).
- `stores.phoneIndex`, `rateLimit.perPhone` and `abuse.maxDistinctPhonesPerIp` are refused at boot, naming the 1.0 name.
- `AbuseStore` requires only `recordSendAttempt` and `countDistinctRecipientsByIp`.
- Every adapter accepts core `>=0.9.0 <2.0.0`.

Upgrade to 0.9 and clear its deprecation warnings first. No database migration. See "Upgrading to 1.0.0" in the README.
