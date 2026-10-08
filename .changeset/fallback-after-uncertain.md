---
"@jadedm/nestjs-verify": patch
"@jadedm/nestjs-verify-twilio": patch
"@jadedm/nestjs-verify-gupshup": patch
---

New core option `delivery.fallbackAfterUncertain`, default `true`, which keeps today's behaviour. After a provider attempt that may have been accepted (it timed out, or its error carries `mayHaveSent: true`), the core tries the next provider in `fallbacks`, and that provider can send the same code a second time. With `fallbackAfterUncertain: false`, the chain stops there: the cooldown starts and `POST /verify/start` answers 503 with `retryAfterMs`. An attempt that failed outright still moves on to the next provider. With the providers' `retryAfterUncertain: false`, a start sends at most once. Twilio and Gupshup: documentation only.
