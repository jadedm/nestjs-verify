# scripts/

Operational scripts for this repo. Not shipped to npm.

## smoke-adapters.mjs

Live integration smoke for the Postgres, Mongo and Redis store adapters. Exercises every store contract (`VerifyStore`, `AbuseStore`, `RateLimitStore`, `CooldownStore`, `PhoneIndexStore`) and the audit sinks against real databases, runs a whole email verification through `VerifyService` on each backend, and asserts each invariant. Use this before cutting a release that touches the adapters, or to verify that a published version still works on a target stack.

### One-shot run

```bash
pnpm test:adapters
```

This spins up Postgres 16, Mongo 7 and Redis 7 in containers, runs the smoke script, and tears them down. Requires Docker.

### Manual run

```bash
docker compose -f scripts/docker-compose.smoke.yml up -d
pnpm build
node scripts/smoke-adapters.mjs
docker compose -f scripts/docker-compose.smoke.yml down -v
```

### Pointing at existing databases

Set environment variables to point the script at any reachable Postgres, Mongo or Redis, and `SMOKE_BACKENDS` to run only some of them (default `postgres,mongo,redis`):

```bash
SMOKE_PG_URL=postgres://user:pass@host:5432/db \
SMOKE_MG_URL=mongodb://host:27017 \
SMOKE_MG_DB=verify_smoke \
SMOKE_REDIS_HOST=localhost SMOKE_REDIS_PORT=6379 \
node scripts/smoke-adapters.mjs
```

The script imports each backend's package only when that backend runs.

## check-packed.mjs

Packs the packages, installs them into a clean project as a consumer would (with each peer at its oldest supported major, `--profile lowest`, or its newest, `--profile highest`), and checks that each loads by name as ESM and CommonJS, ships its types and main files, imports nothing it does not declare, type-checks strictly, and loads without its optional peers.

With `--core floor` it checks only the adapters, each beside the lowest published core its peer range admits, installed from npm (adapters with different ranges run as separate groups). An adapter that imports a value, or names a type in its public types, that the floor core lacks fails until its range's lower bound is raised. A dependency on newer core behaviour, or on a type used only inside the adapter, leaves no trace in the built files and is not caught.

```bash
node scripts/check-packed.mjs --profile lowest
node scripts/check-packed.mjs --profile highest --core floor
```

## smoke-mongo-drivers.mjs

Runs the Mongo part of the smoke from packed tarballs under each `mongodb` driver the store's peer range accepts (default `5.0.0,5,6`), and checks the driver the store actually loads. The workspace installs driver 6 only.

```bash
pnpm test:adapters:mongo-drivers
```

## test-tag-releases.sh

Checks `tag-releases.mjs --after-publish` against a registry that lists a new version late. The script waits for each checked-out version that has no tag or no GitHub release yet; the harness checks that it waits, tags once npm lists the version and shows it as `latest`, waits through the E404 of a first publish, and stops with nothing tagged when the version never appears. Stub `npm`, `git` and `gh` on `PATH` replay a snapshot of the real registry and hide core's current tag and release; every run is `--dry-run`, so nothing is tagged or pushed. Needs `gh` signed in and network access to npm. Not in CI.

```bash
scripts/test-tag-releases.sh
```

### What smoke-adapters asserts

The table lists the `VerifyStore` and `AbuseStore` invariants (`incrementAttempts` is deprecated but still exercised). `reserveAttempt` is checked too: exactly 3 of 10 simultaneous reservations succeed on a record with three attempts, and it never changes the status. The script also checks the rate-limit, cooldown (including atomic claims: one winner of ten simultaneous claims) and phone-index stores, the audit sinks, the Mongo migration lock, and whole verifications through `VerifyService`, including five simultaneous starts sending one code and a burst of wrong checks spending exactly the attempt limit.

| # | Invariant |
|---|---|
| 1 | `create` followed by `get` round-trips the record |
| 2 | `attempts` defaults to 0 |
| 3 | `get` returns null for unknown sid |
| 4 | First `incrementAttempts` returns outcome `incremented` |
| 5 | `attempts` is now 1 |
| 6 | `incrementAttempts` on unknown sid returns outcome `not-found` |
| 7 | `incrementAttempts` at maxAttempts returns outcome `locked-out` |
| 8 | Status flips to `canceled` atomically when locked out |
| 9 | `attempts` equals `maxAttempts` after lockout |
| 10 | `markStatus` succeeds when row is pending |
| 11 | Second `markStatus` returns false |
| 12 | `incrementAttempts` on terminal status returns outcome `not-pending` |
| 13 | `delete` removes the record |
| A1 | `countAttemptsByIp` returns the correct count within window |
| A2 | `countAttemptsByPhone` returns the correct count within window |
| A3 | `countDistinctPhonesByIp` returns the correct distinct count |

All invariants must pass for the script to exit 0. Any failure exits 1 with a descriptive line.
