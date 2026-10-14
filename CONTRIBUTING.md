# Contributing to nestjs-verify

Thanks for considering a contribution. This document describes the workflow this repository uses. It is short on purpose. If anything here is unclear, open a discussion.

## Branching

This repo uses trunk-based development. There is one long-lived branch: `main`. All work happens on short-lived branches off `main` and lands back via a pull request.

Suggested branch prefixes for clarity in the PR list:

| Prefix | Use |
|---|---|
| `feat/` | New feature or capability |
| `fix/` | Bug fix |
| `docs/` | Documentation only |
| `chore/` | Tooling, dependencies, CI |
| `refactor/` | Internal change, no behavior change |
| `test/` | Test-only changes |

Branch names are not enforced. They exist to make the PR list scannable.

## Pull requests

Every change goes through a PR. To merge, the PR needs:

1. A green CI run.
2. All review comments resolved.
3. A changeset, if the change is user-facing.

The PR target branch is always `main`. Force-pushes and deletions on `main` are disabled.

## Changesets

This repo uses [Changesets](https://github.com/changesets/changesets) for versioning. The packages listed in the `linked` group in `.changeset/config.json` share version numbers: a package with a changeset is bumped to the highest version in the group. A package with no changeset is not bumped.

If your change is user-facing (it changes runtime behavior, the public API, the published types, dependencies, or documented behavior), add a changeset:

```bash
pnpm changeset
```

Pick the affected packages, the bump type (`patch`, `minor`, `major`), and write a summary that will appear in the published CHANGELOG. Commit the resulting file in `.changeset/`.

If your change is purely internal (a refactor, a test, a CI tweak, a typo fix in a private comment), no changeset is needed.

## Local development

Use pnpm 10, the version `packageManager` in `package.json` names (on Node 22 or 24, `corepack enable` picks it up; Node 25 and later no longer ship corepack, so install pnpm 10 directly). pnpm 10 runs no dependency install scripts unless allowed; the ones this tree skips are listed under `pnpm.ignoredBuiltDependencies`, and nothing here needs them.

```bash
pnpm install
pnpm build
pnpm test           # unit tests
pnpm typecheck
pnpm test:adapters  # live integration smoke against Postgres, Mongo and Redis, requires Docker
```

The runnable example in `examples/basic-twilio-postgres` wires the core, the Twilio provider, and the Postgres store together. Useful for ad hoc verification.

## Architectural conventions

A handful of things this codebase cares about. Knowing them up front saves review cycles.

* **Strategy interfaces over concrete classes.** SMS providers, verification stores, and abuse stores all live behind small interfaces with multiple swappable implementations. Adapters import only types from the core package and never reach into its internals.
* **Atomic operations in stores.** `reserveAttempt` must be one atomic operation that counts an attempt only while the record is `pending`, not past `expiresAt` and below `maxAttempts`, and never changes the status. The Postgres adapter uses one `UPDATE ... WHERE attempts < max_attempts RETURNING`; the Mongo adapter a filtered `findOneAndUpdate`. New adapters must hold the same contract, and `scripts/smoke-adapters.mjs` checks it.
* **Peer deps stay external in tsup.** Never bundle `@nestjs/common`, `@nestjs/core`, `@nestjs/cache-manager`, `cache-manager`, `reflect-metadata`, `rxjs`, or any provider SDK. Bundling these causes class identity drift in the consumer at runtime, which we have already paid for once.
* **Semver since 1.0.** A breaking change is a `major` changeset, a new feature a `minor`, a fix a `patch`. Each adapter's core peer range ends at the next core major (`workspace:>=0.9.0 <2.0.0`), so a core minor or patch releases no adapter. Raise an adapter's lower bound by hand, with a changeset for that adapter, when it starts relying on something newer in core. `pnpm check:release-plan` fails if the pending changesets would carry a package to a new major by accident, and names the packages. A deliberate major needs a `major` changeset for every public package, all landing on the same X.0.0.

## Releases

Releases are driven by Changesets. Once you have a Trusted Publisher configured on npmjs.com for each package, the path is:

1. Open a PR with a changeset.
2. Merge to `main`.
3. The Changesets action opens a "Version Packages" PR that bumps versions and rewrites changelogs.
4. Review and merge the "Version Packages" PR.
5. The release workflow publishes to npm using GitHub's OIDC token. No NPM_TOKEN is needed.

If Trusted Publishing is not yet configured, the maintainer publishes from their own terminal with `scripts/publish-manual.sh` after `npm login`.

## Reporting bugs and proposing features

* **Bugs:** open a GitHub issue. Include the version of `@jadedm/nestjs-verify`, your NestJS major version, the SMS provider and store you are using, and a minimal reproduction or the smallest curl that triggers it.
* **Features and design questions:** open a discussion before writing code. This saves you the case where the change is already planned for a future package (for example, a separate `@jadedm/nestjs-throttler` rather than baked into verify).

## Code of conduct

Be kind. Assume good faith. Disagree on the substance, not the person.
