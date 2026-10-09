---
"@jadedm/nestjs-verify": patch
"@jadedm/nestjs-verify-postgres": patch
"@jadedm/nestjs-verify-mongo": patch
---

`check` no longer answers `pending` for a wrong code when it can see that another check approved or cancelled the verification while this one was comparing; it answers `canceled`. A check of a finished verification is now counted under the `no_pending` metric outcome. The Postgres and Mongo stores now report why a reservation was refused (expired, or attempts spent) by the database clock that refused it, rather than the server's clock, which could disagree.
