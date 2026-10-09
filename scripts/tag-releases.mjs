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
// --after-publish, for a run straight after a publish: npm takes minutes to
// list a new version or move `latest` to it, and until then this script
// sees nothing new and reports clean (#111). It first waits until npm lists
// each checked-out version that has no tag on origin yet, or no GitHub release
// unless it is a prerelease, and shows it as
// latest unless it is a prerelease; past TAG_RELEASES_WAIT_SECONDS (default
// 600) it stops with nothing tagged and names what npm still lacks. It then
// refuses to finish unless each of those versions is tagged and released
// (a prerelease only tagged).
//
// Usage: node scripts/tag-releases.mjs [--dry-run] [--after-publish]
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
// A mistyped --dry-run must not turn into a real run that pushes tags.
const OPTIONS = ['--dry-run', '--after-publish'];
const unknown = args.filter((a) => !OPTIONS.includes(a));
if (unknown.length > 0) {
  console.error(`tag-releases: unknown option(s) ${unknown.join(' ')}; usage: node scripts/tag-releases.mjs [--dry-run] [--after-publish]`);
  process.exit(2);
}
const dryRun = args.includes('--dry-run');
const afterPublish = args.includes('--after-publish');
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

// What npm does not show yet for each package's checked-out version: not
// listed, or (for a non-prerelease) not yet `latest`. --prefer-online skips
// npm's local cache, which would otherwise keep answering the old listing.
// A package's first publish answers E404 until npm lists it; any other
// failure stops the script.
const npmView = (name) => {
  try {
    return JSON.parse(sh('npm', ['view', name, 'versions', 'dist-tags', '--json', '--prefer-online'], { stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (err) {
    if (/E404/.test(`${err.stdout ?? ''}${err.stderr ?? ''}`)) return { versions: [], 'dist-tags': {} };
    throw err;
  }
};

// The versions a run after a publish waits for: each package's checked-out
// version that has no tag on origin yet, or (unless a prerelease) no GitHub
// release yet, so a rerun after a failed release still waits for it. A
// version tagged and released before is never waited on again, so moving
// `latest` back to an older version on purpose does not stall later runs.
const unfinished = ({ pkg }) => {
  const tag = `${pkg.name}@${pkg.version}`;
  return !existingTags.has(tag) || (!pkg.version.includes('-') && !existingReleases.has(tag));
};
const awaited = afterPublish ? packages.filter(unfinished) : [];

const notYetOnNpm = () =>
  awaited.flatMap(({ pkg }) => {
    const view = npmView(pkg.name);
    const versions = [view.versions].flat();
    if (!versions.includes(pkg.version)) return [`${pkg.name}@${pkg.version} (not listed)`];
    if (pkg.version.includes('-') || view['dist-tags']?.latest === pkg.version) return [];
    return [`${pkg.name}@${pkg.version} (latest is still ${view['dist-tags']?.latest})`];
  });

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

if (afterPublish) {
  const waitSeconds = Number(process.env.TAG_RELEASES_WAIT_SECONDS ?? 600);
  const pollMs = Number(process.env.TAG_RELEASES_POLL_MS ?? 15_000);
  // Atomics.wait reads a NaN timeout as forever.
  if (!(waitSeconds >= 0 && pollMs > 0)) {
    console.error('tag-releases: TAG_RELEASES_WAIT_SECONDS and TAG_RELEASES_POLL_MS must be numbers');
    process.exit(2);
  }
  const deadline = Date.now() + waitSeconds * 1000;
  let missing = notYetOnNpm();
  while (missing.length > 0 && Date.now() < deadline) {
    console.log(`tag-releases: waiting for npm: ${missing.join(', ')}`);
    sleep(pollMs);
    missing = notYetOnNpm();
  }
  if (missing.length > 0) {
    console.error(
      `tag-releases: stopped after ${waitSeconds}s, nothing tagged or released; npm does not show:\n- ${missing.join('\n- ')}\n` +
        'Rerun `node scripts/tag-releases.mjs` once `npm view <package> dist-tags.latest` shows the new version.',
    );
    process.exit(1);
  }
}

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
  const published = JSON.parse(sh('npm', ['view', pkg.name, 'versions', '--json', '--prefer-online']));
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
  // npm's latest tag, so a prerelease published under another dist-tag is not
  // released as the newest.
  const newest = sh('npm', ['view', pkg.name, 'dist-tags.latest', '--prefer-online']);
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

// A stale read in the pass above must not undo the wait: every version the
// wait saw on npm is tagged here, and released unless it is a prerelease.
for (const { pkg } of awaited) {
  const tag = `${pkg.name}@${pkg.version}`;
  if (!existingTags.has(tag) && !toTag.some((t) => t.tag === tag)) problems.push(`${tag} was on npm during the wait but the tagging pass did not list it; rerun`);
  const released = existingReleases.has(tag) || toRelease.some((r) => r.tag === tag);
  if (!pkg.version.includes('-') && !released) problems.push(`${tag} was latest on npm during the wait but the release pass did not see it as latest; rerun`);
}

if (problems.length > 0) {
  console.error(`tag-releases: stopped, nothing tagged or released:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

for (const { tag, sha } of toTag) console.log(`${dryRun ? 'would tag' : 'tag'}      ${tag} at ${sha.slice(0, 7)}`);
for (const { tag, latest } of toRelease) console.log(`${dryRun ? 'would release' : 'release'}  ${tag}${latest ? ' (latest)' : ''}`);
if (toTag.length === 0 && toRelease.length === 0) console.log('tag-releases: every published version is tagged and released');
if (dryRun) process.exit(0);

// -f: a local tag left by an earlier run whose push failed is not on origin,
// so it is replaced rather than stopping the retry.
for (const { tag, sha } of toTag) git('tag', '-f', '-a', tag, sha, '-m', tag);
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
