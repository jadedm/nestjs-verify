# scripts/

Operational scripts for this repo. Not shipped to npm.

## smoke-adapters.mjs

Live integration smoke for the Postgres and Mongo store adapters. Exercises the full `VerifyStore` and `AbuseStore` contracts against real databases and asserts each invariant. Use this before cutting a release that touches the adapters, or to verify that a published version still works on a target stack.

### One-shot run

```bash
pnpm test:adapters
```

This spins up Postgres 16 and Mongo 7 in containers, runs the smoke script, and tears them down. Requires Docker.

### Manual run

```bash
docker compose -f scripts/docker-compose.smoke.yml up -d
pnpm build
node scripts/smoke-adapters.mjs
docker compose -f scripts/docker-compose.smoke.yml down -v
```

### Pointing at existing databases

Set environment variables to point the script at any reachable Postgres or Mongo:

```bash
SMOKE_PG_URL=postgres://user:pass@host:5432/db \
SMOKE_MG_URL=mongodb://host:27017 \
SMOKE_MG_DB=verify_smoke \
node scripts/smoke-adapters.mjs
```

### What it asserts

For each store, 13 invariants. For each abuse store, 3 invariants.

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
