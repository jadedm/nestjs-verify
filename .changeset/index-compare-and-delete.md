---
"@jadedm/nestjs-verify": minor
"@jadedm/nestjs-verify-postgres": minor
"@jadedm/nestjs-verify-mongo": minor
"@jadedm/nestjs-verify-redis": minor
---

Cleaning up after one verification no longer removes the recipient's index entry when a newer verification has replaced it, so the newer code still checks (#9). This covers a failed send, a start that lost its cooldown claim, a failed index write, and `check` after an approval, a lockout or an expired code.

Breaking for custom stores: `PhoneIndexStore` has a new required method, `deleteIfMatches(phone, sid)`, which removes the entry only while it maps `phone` to `sid`, atomically. `VerifyService` refuses a phone index store without it when it is constructed. The shipped stores implement it.

The index entry now expires with its record rather than a full code TTL after the record was written. `check` now also removes the entry when it finds the record expired, locked out, already finished or missing, so a second `check` after any of those answers `NO_PENDING_VERIFICATION` instead of `canceled`, as it already did after an approval. A failed index cleanup after a lockout is logged rather than answered with a 500.
