---
"@jadedm/nestjs-verify": patch
"@jadedm/nestjs-verify-twilio": patch
"@jadedm/nestjs-verify-gupshup": patch
---

A provider error can now say the request may have been accepted, and the core treats it like a timeout: it starts the recipient's cooldown before answering 503, and the 503 carries `retryAfterMs`. Before, an error from a provider was always taken as "nothing sent", so after a 504 or a dropped connection the user's immediate retry could send a second message. Twilio's and Gupshup's own internal retries still run after such a failure and can deliver the same code again (#43).

- Core: an error with `mayHaveSent: true` (exactly `true`) counts as possibly delivered, including after the recipient scrub that rebuilds provider errors.
- Twilio and Gupshup set `mayHaveSent: true` on the error they throw when any attempt got HTTP 500, 502 or 504, a response that broke after its headers, or a network error other than a refused connection, DNS failure, unreachable host or network, or (Gupshup) connect timeout. 429 and 503 are not marked. Unknown network errors are marked, which errs toward a cooldown. The property is plain, so these providers still work with older core versions, which ignore it.
