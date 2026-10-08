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

```bash
pnpm install
pnpm build
pnpm test           # unit tests
pnpm typecheck
pnpm test:adapters  # live integration smoke against Postgres + Mongo, requires Docker
```

The runnable example in `examples/basic-twilio-postgres` wires the core, the Twilio provider, and the Postgres store together. Useful for ad hoc verification.

## Architectural conventions

A handful of things this codebase cares about. Knowing them up front saves review cycles.

* **Strategy interfaces over concrete classes.** SMS providers, verification stores, and abuse stores all live behind small interfaces with multiple swappable implementations. Adapters import only types from the core package and never reach into its internals.
* **Atomic operations in stores.** `incrementAttempts` must be one round trip and must atomically transition status to `canceled` on lockout. The Postgres adapter uses `UPDATE ... RETURNING` with a `CASE` expression. The Mongo adapter uses a `findOneAndUpdate` with an aggregation pipeline. New adapters must hold the same contract.
* **Peer deps stay external in tsup.** Never bundle `@nestjs/common`, `@nestjs/core`, `@nestjs/cache-manager`, `cache-manager`, `reflect-metadata`, `rxjs`, or any provider SDK. Bundling these causes class identity drift in the consumer at runtime, which we have already paid for once.
* **Pre-1.0 minor bumps are breaking.** We are pre-1.0. A `minor` changeset means "users may need to update code." Use `patch` for true non-breaking changes only. A core `minor` must also widen each compatible adapter's core peer range to the new minor (for example `workspace:>=0.6.8 <0.8.0`) with a changeset for that adapter, so npm gets the new range; otherwise Changesets plans every package at 1.0.0. `pnpm check:release-plan` fails on either mistake and names the packages. Raise the lower bound by hand when an adapter starts relying on something newer in core.

## Releases

Releases are driven by Changesets. Once you have a Trusted Publisher configured on npmjs.com for each package, the path is:

1. Open a PR with a changeset.
2. Merge to `main`.
3. The Changesets action opens a "Version Packages" PR that bumps versions and rewrites changelogs.
4. Review and merge the "Version Packages" PR.
5. The release workflow publishes to npm using GitHub's OIDC token. No NPM_TOKEN is needed.

If Trusted Publishing is not yet configured, the maintainer publishes manually with `npm publish --otp=...` once per published package.

## Reporting bugs and proposing features

* **Bugs:** open a GitHub issue. Include the version of `@jadedm/nestjs-verify`, your NestJS major version, the SMS provider and store you are using, and a minimal reproduction or the smallest curl that triggers it.
* **Features and design questions:** open a discussion before writing code. This saves you the case where the change is already planned for a future package (for example, a separate `@jadedm/nestjs-throttler` rather than baked into verify).

## Code of conduct

Be kind. Assume good faith. Disagree on the substance, not the person.
