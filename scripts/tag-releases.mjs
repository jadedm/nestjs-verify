#!/usr/bin/env node
// Tags every published version and gives each package's newest version a
// GitHub release (#91). Hand publishing (scripts/publish-manual.sh) runs
// `pnpm publish`, which creates no tag, so without this the repository's
// newest tags and releases lag what npm has.
//
// For each package in packages/*: list its versions on npm; for each version
// with no `<name>@<version>` tag on origin, find the commit on main's own
// line (first parent) where the package's package.json first carried that
// version (the release commit) and create an annotated tag there. Then push
// the new tags, and create a GitHub release for the version npm marks latest
// if it has none, with that version's CHANGELOG section at the release commit
// as the notes. The core package is marked latest.
//
// Fails closed: a published version with no release commit on main, or a
// newest version with no CHANGELOG section, stops the script before anything
// is pushed.
//
// Usage: node scripts/tag-releases.mjs [--dry-run]
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const CORE = '@jadedm/nestjs-verify';

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts }).trim();
const git = (...args) => sh('git', args);
git('fetch', '--quiet', 'origin', 'main');
// The tags on origin, not local ones: a local tag left by a failed push must
// not count as done.
const existingTags = new Set(
  git('ls-remote', '--tags', 'origin')
    .split('\n')
    .map((line) => line.split('\trefs/tags/')[1])
    .filter((tag) => tag && !tag.endsWith('^{}')),
);
const existingReleases = new Set(
  JSON.parse(sh('gh', ['release', 'list', '--limit', '1000', '--json', 'tagName'])).map((r) => r.tagName),
);

const packages = readdirSync(path.join(root, 'packages'))
  .map((dir) => ({ dir, pkg: JSON.parse(readFileSync(path.join(root, 'packages', dir, 'package.json'), 'utf8')) }))
  .filter(({ pkg }) => !pkg.private);

// The oldest commit on main's own line (first parent: a branch merged without
// squash is not walked into) whose package.json for `dir` has `version`.
const releaseCommit = (dir, version) => {
  const file = `packages/${dir}/package.json`;
  const candidates = git('log', '--first-parent', '--format=%H', '--reverse', '-S', `"version": "${version}"`, 'origin/main', '--', file)
    .split('\n')
    .filter(Boolean);
  return candidates.find((sha) => JSON.parse(git('show', `${sha}:${file}`)).version === version);
};

// The `## <version>` section of a package CHANGELOG at the release commit,
// without its heading.
const changelogSection = (dir, version, sha) => {
  const text = git('show', `${sha}:packages/${dir}/CHANGELOG.md`);
  const start = text.indexOf(`\n## ${version}\n`);
  if (start === -1) return undefined;
  const body = text.slice(start + `\n## ${version}\n`.length);
  const next = body.search(/\n## \d/);
  return (next === -1 ? body : body.slice(0, next)).trim();
};

const toTag = [];
const toRelease = [];
const problems = [];
for (const { dir, pkg } of packages) {
  const published = JSON.parse(sh('npm', ['view', pkg.name, 'versions', '--json']));
  const versions = Array.isArray(published) ? published : [published];
  for (const version of versions) {
    const tag = `${pkg.name}@${version}`;
    if (existingTags.has(tag)) continue;
    const sha = releaseCommit(dir, version);
    if (!sha) {
      problems.push(`${tag} is on npm but no commit on origin/main has that version in packages/${dir}/package.json`);
      continue;
    }
    toTag.push({ tag, sha });
  }
  // npm's latest tag, so a prerelease is never released as the newest.
  const newest = sh('npm', ['view', pkg.name, 'dist-tags.latest']);
  const tag = `${pkg.name}@${newest}`;
  if (existingReleases.has(tag)) continue;
  const newestSha = releaseCommit(dir, newest);
  if (!newestSha) continue; // reported above as a version with no commit
  const notes = changelogSection(dir, newest, newestSha);
  if (notes === undefined) {
    problems.push(`packages/${dir}/CHANGELOG.md has no "## ${newest}" section for the release of ${tag}`);
    continue;
  }
  toRelease.push({ tag, notes, latest: pkg.name === CORE });
}

if (problems.length > 0) {
  console.error(`tag-releases: stopped, nothing tagged or released:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

for (const { tag, sha } of toTag) console.log(`${dryRun ? 'would tag' : 'tag'}      ${tag} at ${sha.slice(0, 7)}`);
for (const { tag, latest } of toRelease) console.log(`${dryRun ? 'would release' : 'release'}  ${tag}${latest ? ' (latest)' : ''}`);
if (toTag.length === 0 && toRelease.length === 0) console.log('tag-releases: every published version is tagged and released');
if (dryRun) process.exit(0);

for (const { tag, sha } of toTag) git('tag', '-a', tag, sha, '-m', tag);
if (toTag.length > 0) git('push', '--quiet', 'origin', ...toTag.map(({ tag }) => `refs/tags/${tag}`));

const work = mkdtempSync(path.join(tmpdir(), 'tag-releases-'));
try {
  for (const { tag, notes, latest } of toRelease) {
    const notesFile = path.join(work, 'notes.md');
    writeFileSync(notesFile, `${notes}\n`);
    sh('gh', ['release', 'create', tag, '--verify-tag', '--title', tag, '--notes-file', notesFile, `--latest=${latest}`]);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`tag-releases: ${toTag.length} tag(s) pushed, ${toRelease.length} release(s) created`);
