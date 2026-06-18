<!--
Thanks for the PR. A few quick prompts to save us both time during review.
-->

## What this PR does

<!-- One or two sentences. The reader should understand the change without opening files. -->

## Why

<!-- The motivation. A bug? A use case? A doc gap? Link to the issue or discussion if there is one. -->

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change (API or behavior changes that consumers will feel)
- [ ] Documentation only
- [ ] Internal change (refactor, test, tooling, CI)

## Changeset

- [ ] I ran `pnpm changeset` and committed the result
- [ ] This change does not need a changeset (pure internal change)

If you skipped the changeset, justify it in one line. Reviewers will push back if the change is user-facing.

## Testing

<!-- How did you verify this works? Unit tests added, `pnpm test:adapters` run, manual curl, ran the example app, etc. -->

## Breaking changes

<!-- Only fill this in if you ticked "Breaking change" above. Describe the migration path for existing users. -->

## Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] If adapters or store interfaces changed: `pnpm test:adapters` passes
- [ ] CHANGELOG entry will be generated from the changeset summary, no need to edit by hand
