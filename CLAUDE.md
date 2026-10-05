# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A pnpm monorepo publishing `@jadedm/nestjs-verify`: self-hosted, Twilio Verify-style OTP for NestJS.
`POST /verify/start` sends a code, `POST /verify/check` checks it. The library owns code generation,
TTL, attempt caps, cooldowns, rate limits and abuse checks; the host app picks the SMS or email
provider and the stores. Published packages live in `packages/*`; `examples/basic-twilio-postgres` is
a private runnable app wiring core, Twilio and Postgres together.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm build              # tsup in every package; must run before typecheck
pnpm typecheck          # tsc --noEmit per package
pnpm test               # vitest run across all packages
pnpm test:adapters      # Docker: Postgres 16, Mongo 7, Redis; builds, runs scripts/smoke-adapters.mjs, tears down
```

Single package or single test:

```bash
pnpm --filter @jadedm/nestjs-verify test
pnpm --filter @jadedm/nestjs-verify exec vitest run src/verify.service.test.ts -t "<test name>"
```

The CI gate (`.github/workflows/ci.yml`) is build, typecheck, test, plus a separate `test:adapters`
job. Build comes first because adapters resolve `@jadedm/nestjs-verify` types through its
`dist/index.d.ts`; a stale or missing core `dist` gives wrong typecheck results in the adapters.

`pnpm lint` exists at the root but no package defines a `lint` script, so it does nothing and exits 0.
There is no linter in this repo.

Adapter packages run `vitest --passWithNoTests`, so a package with no tests reports green. Store
adapters (Postgres, Mongo, Redis) are covered only by `pnpm test:adapters`, not by `pnpm test`. Run it
for any change to a store adapter or a store interface. `SMOKE_PG_URL`, `SMOKE_MG_URL`, `SMOKE_MG_DB`,
`SMOKE_REDIS_HOST` and `SMOKE_REDIS_PORT` point it at existing databases instead (read at the top of
`scripts/smoke-adapters.mjs`; `scripts/README.md` lists only the Postgres and Mongo ones).

## Architecture

Core (`packages/core/src`):

- `verify.module.ts`: `VerifyModule.forRoot` / `forRootAsync` bind the options under
  `VERIFY_MODULE_OPTIONS` and provide `VerifyService`. `forRoot` mounts `VerifyController` unless
  `registerController: false`; `forRootAsync` always mounts it and ignores that option (#18).
- `verify.service.ts`: all flow logic. `start`: resolve recipient, cooldown, per-phone then per-IP
  rate limit, IP velocity check, create record and phone index, send, then start cooldown and record
  the send. If the send or that follow-up bookkeeping fails, the record and index are deleted and
  `SmsDispatchFailedException` (503) is thrown. `check`: phone index to sid, load record, only a
  `pending` record can approve, expiry is checked lazily on read, a wrong code calls the store's atomic
  `incrementAttempts`.
- `recipient.ts`: a recipient has a `key` (store key: E.164 phone, or the lowercased email) and an
  `address` (where the code is sent). On `check` the channel is not sent, so SMS vs email is inferred
  from whether `to` contains `@`. Store fields named `phone` hold email addresses too.
- `dispatch.ts`: builds a provider chain per delivery kind (primary plus fallbacks, tried in order)
  and scrubs the recipient out of provider error messages before they reach logs, spans or the abuse
  store.
- Voice and WhatsApp are part of `VerificationChannel` but have no sender. `recipientFor` in
  `recipient.ts` refuses them with `CHANNEL_NOT_SUPPORTED` before any state is touched.
- `errors.ts`: request errors the service raises on purpose are `VerifyException`s (an
  `HttpException`) carrying a stable `VerifyErrorCode` string. Clients branch on these codes, so they
  are wire contract. A failed send, SMS or email, returns `SMS_DISPATCH_FAILED`, and so does a store
  failure in the bookkeeping right after the send. A failed index cleanup after an approval is only
  logged. Other store errors pass through unwrapped, and `generateCode` throws a plain `Error` for a
  length outside 4 to 10.
- Responses carry the verification's `state`, not `status`, so they do not collide with JSend-style
  envelopes. `start` returns `pending`; `check` returns `approved`, `pending` or `canceled`. An
  expired code is a 400 `CODE_EXPIRED`, and a record that already finished answers `canceled`.
- Codes are stored as salted SHA-256 and compared in constant time (`code/code-gen.ts`).
- The audit sink and prom-client metrics are optional. `@opentelemetry/api` is a required peer;
  spans are emitted only when the host app registers an OpenTelemetry SDK. Audit sink failures are
  logged and never fail a verification.

Five store interfaces in `packages/core/src/interfaces`: `VerifyStore`, `AbuseStore` (optional),
`RateLimitStore`, `CooldownStore`, `PhoneIndexStore`, plus an optional `AuditSink`. Core ships
in-memory versions (`createMemoryStores()`). Each backend package exposes a `create*Stores` factory:

- Postgres and Mongo implement all five plus an audit sink. Their `create*Stores` factory runs
  versioned migrations (`migrations.ts`, `migration-runner.ts`); with `skipSchemaSetup: true` it only
  checks the schema version. Postgres takes an advisory lock and records versions in
  `verify_schema_versions`. A schema change is a new migration entry, never an edit to an old one.
- Redis implements only the three short-lived stores (rate limit, cooldown, phone index) and must be
  paired with a durable verify store.

Providers (`provider-twilio`, `provider-gupshup`, `provider-ses`) implement `SmsProvider` or
`EmailProvider` from core.

## Contracts that adapters must hold

- `VerifyStore.incrementAttempts` is a single atomic round trip that increments attempts and, on
  reaching `maxAttempts`, flips status to `canceled` in the same operation. Postgres does this with
  `UPDATE ... RETURNING` and a `CASE`; Mongo with `findOneAndUpdate` and an aggregation pipeline.
- `markStatus` only transitions out of `pending` and returns false if the record was no longer pending.
- `scripts/smoke-adapters.mjs` encodes these invariants; a new adapter or store method gets cases
  there.
- Adapters import from the `@jadedm/nestjs-verify` entry point only, never core internals, and almost
  only types. The exception is `provider-gupshup`, which imports `asyncHandler` as a value. Core is a
  `workspace:^` peer dependency of each adapter.

## Build rules

- Peer dependencies are never bundled. Each `tsup.config.ts` lists them in `external`. Bundling
  `@nestjs/common` breaks class identity for `HttpException`, and Nest then answers 500 instead of the
  intended status. Any new peer dependency is added to `external` in the same change.
- Core's tsup config injects `__PACKAGE_VERSION__` from `package.json` at build time.
- ESM and CJS are both emitted. Source imports use `.js` extensions (`NodeNext` resolution).

## Releases

Changesets. A user-facing change (runtime behaviour, public API, types, dependencies, documented
behaviour) needs a `pnpm changeset` file; internal-only changes do not. Pre-1.0, a `minor` bump means
breaking.

The intended path is `.github/workflows/release.yml`: on push to `main`, `changesets/action` either
opens a "Version Packages" PR or, with no pending changesets, publishes any package whose local
version is not on npm, through npm Trusted Publishing (OIDC). As of 0.6.0 that path has never
succeeded: every release run with something to publish failed with `E404 Not Found - PUT`, npm's
answer to an unauthenticated publish. The workflow runs Node 22, whose bundled npm 10 cannot do
trusted publishing (it needs 11.5.1 or later), and trusted publishers are probably not configured
on npmjs.com either (#19). Every version on npm (0.1.0 to 0.5.0) was published by hand from the
maintainer's account.

Until #19 is done, publish with `scripts/publish-manual.sh`, run by the owner in their own terminal
after `npm login`. npm asks for 2FA as a browser approval, so `--otp` is optional. From a shell with
no terminal attached (an agent's shell) the publish fails with `EOTP`, so hand the command over.

Releases so far have been cut as `release/x.y.z` branches with hand-bumped versions, not through a
"Version Packages" PR. A core `minor` changeset would currently version every package 1.0.0 (#10).

`packages/provider-ses` is `"private": true` and is never published, though the README lists it.

The `linked` group in `.changeset/config.json` lists only core, twilio, postgres and ses. Gupshup,
mongo and redis are outside it even though the README says all packages version in lockstep.

## Workflow

Trunk-based on `main`, every change through a PR (`CONTRIBUTING.md`).
