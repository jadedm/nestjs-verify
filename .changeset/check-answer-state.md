---
"@jadedm/nestjs-verify": patch
"@jadedm/nestjs-verify-postgres": patch
"@jadedm/nestjs-verify-mongo": patch
---

`check` no longer answers `pending` for a wrong code when it can see that another check approved or cancelled the verification while this one was comparing; it answers `canceled`. A check of a finished verification is now counted under the `no_pending` metric outcome.

`check` now leaves the expiry decision to the verify store's `reserveAttempt`, which already refused expired records, instead of first comparing `expiresAt` with the server's clock. With the Postgres or Mongo store, expiry is therefore judged by the database clock, and a refused reservation is reported as expired or as spent attempts by that same clock. The Mongo phone index still judges its own entry's expiry by the server's clock.
