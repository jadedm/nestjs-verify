---
"@jadedm/nestjs-verify": patch
---

When a send fails and at least one provider attempt timed out, the message may still arrive, so `POST /verify/start` now starts the recipient's cooldown before answering 503 `SMS_DISPATCH_FAILED`, and the 503 body carries `retryAfterMs`. An immediate retry gets 429 `COOLDOWN_ACTIVE` instead of starting another send while the first may be in flight. When every provider failed outright, nothing changes: no cooldown, and a retry is accepted at once.
