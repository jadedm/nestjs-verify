---
"@jadedm/nestjs-verify": patch
"@jadedm/nestjs-verify-twilio": patch
"@jadedm/nestjs-verify-gupshup": patch
---

New core option `delivery.fallbackAfterUncertain`, default `true`, which keeps today's behaviour. After a provider attempt that may have been accepted (it timed out, or its error carries `mayHaveSent: true`), the core tries the next provider in `fallbacks`, and that provider can send the same code a second time. With `fallbackAfterUncertain: false`, the chain stops there: the cooldown starts and `POST /verify/start` answers 503, with `retryAfterMs` when the cooldown write succeeds. An attempt that failed outright still moves on to the next provider. A non-boolean value fails at startup. A start sends at most once only when every provider in the chain marks uncertain failures and does not retry after them, such as Twilio and Gupshup with `retryAfterUncertain: false`; SES and unmarked custom providers do not qualify. Twilio and Gupshup: documentation only.
