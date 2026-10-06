---
"@jadedm/nestjs-verify": patch
"@jadedm/nestjs-verify-twilio": patch
"@jadedm/nestjs-verify-gupshup": patch
"@jadedm/nestjs-verify-ses": patch
---

Provider sends now have time limits. Before, a provider that never answered held `POST /verify/start` open indefinitely and the fallbacks were never tried.

- New `delivery` option: `attemptTimeoutMs` (default 5000) limits one provider attempt, and `totalTimeoutMs` (default 10000) limits the whole chain. An attempt past its limit counts as a failure and the next provider is tried; when the total is spent the request fails with 503 `SMS_DISPATCH_FAILED`. Invalid values fail at startup.
- Providers receive an `AbortSignal` as an optional second argument to `send`, aborted at the attempt's limit. SES passes it to the AWS SDK, Gupshup to `fetch`; Twilio and Gupshup stop retrying once it aborts. Custom providers can ignore it.
- A request already in flight may still deliver after its limit, so a fallback can send a second message carrying the same code.
- Logged provider errors keep the AWS request id.
