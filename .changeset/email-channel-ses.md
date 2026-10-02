---
"@jadedm/nestjs-verify": minor
"@jadedm/nestjs-verify-ses": minor
---

Email channel and an Amazon SES provider.

- New `email` module option (`provider`, `fallbacks`, `subject`, `template`) and an `EmailProvider` interface, plus `MockEmailProvider` for development and tests. `sms` is now optional; at least one of `sms` or `email` must be configured.
- Start a verification with `channel: 'email'` and an email address in `to`. `check` takes the address as before. The whole address is lowercased for cooldowns, rate limits and lookup, so case variants of one mailbox share them; the code is sent to the address as given. Addresses with display-name or list characters (`<>()[],;:"\`) are rejected.
- New package `@jadedm/nestjs-verify-ses`: `SesEmailProvider` sends through SES v2. It needs Node 20 or newer, as current AWS SDK releases do.
- New error codes `INVALID_EMAIL` and `CHANNEL_NOT_SUPPORTED`.
- Behaviour change: a channel with no configured provider is rejected with `CHANNEL_NOT_SUPPORTED`. Before, every channel was silently sent as SMS. This covers `voice` and `whatsapp` always, and `email` on a deployment that configures only `sms`.
- Logs, audit events and abuse records now name the provider that actually sent the code when a fallback succeeds; before, they named the primary. When every provider fails, the abuse record's `provider` is the comma-joined chain (`twilio,gupshup`).
- Store fields named `phone` hold the email address for email verifications. No schema change.
- Provider error messages have the recipient replaced with `[recipient]` before they reach logs, spans and the abuse store.
- Type change: `VerifyModuleOptions.sms` is now optional, so code that reads `options.sms.provider` from a typed options object needs a guard.
- Request validation: `to` now accepts an email address, and the validator's message for a malformed `to` changed to 'to must be an E.164 phone, e.g. +14155552671, or an email address'. A request with an email in `to` and no channel gets the service's `INVALID_PHONE` error instead of the validator's message.
- A failed email send returns `SMS_DISPATCH_FAILED`, the same code as SMS.
- Email sends are not recorded in `verify_sms_send_duration_seconds`; a channel-aware metric is tracked separately.
