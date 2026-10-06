---
"@jadedm/nestjs-verify": patch
---

Whenever a message may have gone out, `POST /verify/start` now starts the recipient's cooldown before answering 503 `SMS_DISPATCH_FAILED`, and the 503 body carries `retryAfterMs` when that write succeeded. That covers a send where a provider attempt timed out (the message may still arrive) and a send that succeeded but whose bookkeeping failed. An immediate retry gets 429 `COOLDOWN_ACTIVE` instead of starting another send. The cooldown is written before the failure cleanup, so a failing store cannot skip it. When every provider answered with an error rather than timing out, nothing changes: no cooldown, and a retry is accepted at once. Cleanup after a failed start no longer turns the 503 into a 500 when a store fails, and each cleanup step runs even if an earlier one failed.

Also fixed: a provider whose `send` threw synchronously skipped the scrub that removes the recipient from error messages, so a phone number or address could reach logs and the abuse record.
