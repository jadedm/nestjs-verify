---
"@jadedm/nestjs-verify-twilio": patch
"@jadedm/nestjs-verify-gupshup": patch
"@jadedm/nestjs-verify": patch
---

New provider option `retryAfterUncertain` (Twilio and Gupshup), default `true`, which keeps today's behaviour. Both providers retry a 500, 502, 504 or a network failure inside one send; when the failed attempt may already have been accepted, a retry can deliver the same code a second time. With `retryAfterUncertain: false`, such a failure is thrown at once, marked `mayHaveSent`, so the core starts the cooldown and the user retries after it. Failures known not to have sent (429, 503, a refused connection, a DNS failure) are still retried. The option does not stop the core trying the next provider in `fallbacks` (#51). Also fixed: a frozen Twilio error is now wrapped so the may-have-sent mark is not lost, and a Gupshup request aborted by the core now rejects with the abort reason instead of a provider error. The core change is documentation only.
