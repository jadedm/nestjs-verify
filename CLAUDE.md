# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A pnpm monorepo publishing `@jadedm/nestjs-verify`: self-hosted, Twilio Verify-style OTP for NestJS.
`POST /verify/start` sends a code, `POST /verify/check` checks it. The library owns code generation,
TTL, attempt caps, cooldowns, rate limits and abuse checks; the host app picks the SMS or email
provider and the stores. Published packages live in `packages/*`; `examples/basic-twilio-postgres` is
a private runnable app wiring core, Twilio and Postgres together.

## Commands

Development needs Node 20.19 or newer (vitest 4 and vite 7); the published packages still support Node 18, which CI's `packed` job checks.

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

Adapter packages run `vitest --passWithNoTests`, so a package with no tests reports green. The store
methods (Postgres, Mongo, Redis) are covered only by `pnpm test:adapters`, not by `pnpm test`; Postgres
has unit tests only for pool ownership and the migration runner, against scripted clients. Run it
for any change to a store adapter or a store interface. `SMOKE_PG_URL`, `SMOKE_MG_URL`, `SMOKE_MG_DB`,
`SMOKE_REDIS_HOST` and `SMOKE_REDIS_PORT` point it at existing databases instead (read at the top of
`scripts/smoke-adapters.mjs`; `scripts/README.md` lists only the Postgres and Mongo ones).

## Architecture

Core (`packages/core/src`):

- `verify.module.ts`: `VerifyModule.forRoot` / `forRootAsync` bind the options under
  `VERIFY_MODULE_OPTIONS` and provide `VerifyService`. `forRoot` mounts `VerifyController` unless
  `registerController: false`; `forRootAsync` always mounts it and ignores that option (#18).
- `verify.service.ts`: all flow logic. `start`: resolve recipient, claim the cooldown atomically for
  this sid (`CooldownStore.claim`; of simultaneous starts for one recipient only one gets past it,
  #13), per-phone then per-IP rate limit, IP velocity check, create the record, renew the claim, write
  the phone index, renew it again, send, then start the cooldown and record the send. A start whose
  claim lapsed and was taken stops at a renewal with 429 and removes only its own record. A refusal
  before the send, or a send that definitely failed, releases the claim (after its cleanup), so it
  leaves no cooldown. If the send or the bookkeeping after it fails, the record and
  index are deleted and `SmsDispatchFailedException` (503) is thrown. `check`: phone index to sid, load record, only a
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
- `CooldownStore.claim` decides the holder in one atomic operation and renews for the same holder;
  `release` and `PhoneIndexStore.deleteIfMatches` remove only what the given holder or sid still owns
  (#13, #9). The service never deletes an index entry with the unconditional `delete`.
- `scripts/smoke-adapters.mjs` encodes these invariants; a new adapter or store method gets cases
  there.
- Adapters import from the `@jadedm/nestjs-verify` entry point only, never core internals, and almost
  only types. The exception is `provider-gupshup`, which imports `asyncHandler` as a value. Core is a peer
  dependency of each adapter, bounded to the core minors it is known to work with (Releases, below).

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

Release path, `.github/workflows/release.yml`, on every push to `main`:
- With pending changesets, `changesets/action` runs `pnpm changeset version` and opens or updates a
  "Version Packages" PR (Actions is allowed to create PRs in this repo since 6 Oct 2026). Before #19
  the step ran `pnpm version`, which pnpm passes to `npm version` and which changes nothing.
- GitHub runs no workflows on a PR opened with the Actions token, so the Version Packages PR has no
  checks and branch protection refuses to merge it. Push an empty commit under your own account to
  `changeset-release/main` (`git commit --allow-empty` on a checkout of it, then push) so CI runs
  on a commit the bot did not author, then merge; do not merge with `--admin`. Closing and
  reopening the PR ran CI for 0.6.4 but left 0.6.5 BLOCKED with every check green. It also carries
  Changesets' formatting-only rewrite of `store-redis/package.json`, which changes no version.
- After a hand publish, npm can take about three minutes to show the new versions; wait before
  reading a missing version as a failed publish.
- With none, it publishes every package whose local version is not on npm, through npm trusted
  publishing (OIDC, no token). The job upgrades npm to 11 and `scripts/check-publish-env.mjs` fails
  the run unless npm is 11.5.1+ and Node 22.14.0+. Every release run through 0.6.3 that tried to
  publish failed with E404: the job ran npm 10, which cannot publish with OIDC. It publishes with
  `pnpm changeset publish`, after `check:exports` has loaded that same build.
- Each package needs a trusted publisher on npmjs.com (owner step, per package). None is set up: on
  6 Oct 2026 the owner chose to keep publishing by hand for now, so after a Version Packages merge
  the job's publish fails with E404 and the owner runs the fallback below. #19 stays open until
  trusted publishers exist and one CI publish has gone through.

Fallback: `scripts/publish-manual.sh`, run by the owner in their own terminal after `npm login`. It ends by running `scripts/tag-releases.mjs`, which tags every published version at its release commit and creates a GitHub release for each package's newest version (`--dry-run` to preview); hand publishes from 0.6.0 to 0.7.0 created no tags, so the repo showed 0.5.0 until #91. npm
asks for 2FA as a browser approval, so `--otp` is optional. From a shell with no terminal attached (an
agent's shell) the publish fails with `EOTP`, so hand the command over. Every version so far
(through 0.7.0, 9 Oct 2026) was published by hand from the owner's account. Releases 0.6.1 to 0.6.3 were cut by hand on `release/x.y.z` branches with
`pnpm changeset version`; Changesets also rewrites unrelated `package.json` formatting, which those
release PRs dropped.

Each adapter's core peer range names the core versions it works with: `workspace:>=0.6.8 <0.7.0`
today. Changesets bumps a package at major when a release leaves its peer range, and in 0.x that is
1.0.0; for core, twilio, postgres and ses the linked group then carries the others with it (#10). So
the PR that adds a core `minor` changeset also widens the range (`<0.8.0`) of every adapter that works
with the new core, with a changeset for each so npm gets the new range, and an adapter that needs code
changes gets them in that release. Changesets leaves a range alone while releases stay inside it, so raise
the lower bound by hand when an adapter starts relying on something newer in core. Because core,
twilio, postgres and ses share one version line, a minor on one of those three without core would
put core's next patch on that minor. The check refuses it while the ranges exclude that minor; once
they admit it, core's next release counts as a new minor and must release the adapters with it. The experimental
`onlyUpdatePeerDependentsWhenOutOfRange` flag in `.changeset/config.json` keeps an adapter unbumped
while core stays inside its range; without it every core minor or major bumps every adapter at major
(patches never do). `pnpm check:release-plan` (CI build job) fails if the pending changesets plan
anything at 1.0.0, naming the ranges to widen, or move core to a new minor without releasing every
adapter whose range admits it; probe changesets check the flag.

The `linked` group in `.changeset/config.json` lists only core, twilio, postgres and ses. Gupshup,
mongo and redis version on their own.

## Workflow

Trunk-based on `main`, every change through a PR (`CONTRIBUTING.md`).
