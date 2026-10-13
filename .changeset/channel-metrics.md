---
"@jadedm/nestjs-verify": minor
---

Breaking: a `channel` label on metrics, and recipient-neutral telemetry names (#7).

- `verify_starts_total`, `verify_starts_blocked_total`, `verify_checks_total` and `verify_check_duration_seconds` gain a `channel` label (`sms` or `email`).
- `verify_send_duration_seconds{channel,provider,outcome}` times every send, SMS and email. `verify_sms_send_duration_seconds` stays, deprecated, for SMS sends only.
- `verify_recipient_rate_limit_hits_total{channel}` replaces `verify_phone_rate_limit_hits_total`, which stays, deprecated and unlabelled. Old and new count the same events; do not add them.
- The blocked-start reason and the audit outcome `phone_rate_limit` are now `recipient_rate_limit`, with no alias, because an alias would count every block twice.
- Spans set `verify.recipient_redacted` and, until 1.0, `verify.phone_redacted`; the check span now sets `verify.channel`. Velocity audit events carry `distinctRecipients` and, until 1.0, `distinctPhones`. `LoggerAuditSink` logs `recipient` and, until 1.0, `phone`.
- The exported `MetricsRecorder` interface gains `sendDuration` and `recipientRateLimitHits`; its other methods take an optional channel. A TypeScript class implementing it must add the new methods.
- Fixed: a second recorder on the same prom-client registry, from a second `VerifyModule` or a test harness, threw "already been registered". It now shares the registry's collectors, and refuses at construction one registered under the same name with other labels or as another metric type.
