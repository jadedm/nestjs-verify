---
"@jadedm/nestjs-verify-mongo": patch
---

The Mongo stores now work with `mongodb` driver 5, which their peer range accepts (#79). Under driver 5 the rate limiter threw on every hit, failed attempts never reported a lockout, and the migration lock never made a second instance wait, because driver 5's `findOneAndUpdate` returns a result object where driver 6 returns the document. CI now runs the Mongo smoke under drivers 5 and 6.
