---
"@jadedm/nestjs-verify": minor
"@jadedm/nestjs-verify-postgres": minor
"@jadedm/nestjs-verify-mongo": minor
---

Security: `check` now counts the attempt before it compares the code, so simultaneous checks for one verification can no longer compare more codes than `attempts.max`. Before, every check already in flight compared its code before the lockout was written, which let a burst of requests make more guesses than the limit allows.

Breaking for custom stores: `VerifyStore` has a new required method, `reserveAttempt(sid)`, that increments attempts in one atomic operation only while the record is pending and below `maxAttempts`, and never changes the status. `VerifyService` refuses a verify store without it when it is constructed. `incrementAttempts` is no longer part of the interface; the shipped Postgres, Mongo and memory stores keep it, deprecated.

A correct code submitted at the same moment as a wrong code that spends the last attempt can be answered `canceled`: the check fails closed rather than allowing an extra guess. A record created with `maxAttempts` of 0 now refuses every code. `reserveAttempt` also refuses a record past its expiry, so a code is never compared after it expires.

The Postgres and Mongo stores also accept `@jadedm/nestjs-verify` 0.8 as a peer (`>=0.6.8 <0.9.0`).
