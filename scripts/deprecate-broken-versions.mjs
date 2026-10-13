#!/usr/bin/env node
// Deprecates every published version that cannot be installed because its
// peer dependency on core was published as an unresolved `workspace:` range
// (#114). Adapter versions before 0.6.0 were published that way; npm cannot
// resolve `workspace:^`, so installing them fails.
//
// The versions are found by that rule, not from a list: for each package in
// packages/*, every version on npm whose core peer starts with `workspace:`
// and that is not deprecated yet. Without --apply it only prints them.
//
// With --apply it first checks `npm whoami`: npm answers a write that is not
// signed in with E404, which reads as a missing package. (An account that is
// signed in but has no rights to the package still gets that E404.) It then runs one
// `npm deprecate` per package, with a range listing exactly that package's
// versions to deprecate (`0.1.0 || 0.2.0`). npm marks every matching version
// in one write, so 2FA asks for one approval per package rather than one
// per version (a browser approval, or --otp <code> passed through). It stops
// at the first failure, naming what is done and what is left; a rerun skips
// the versions already deprecated. It then reads every version back, waiting
// up to DEPRECATE_WAIT_SECONDS (default 300) for npm to show the deprecation,
// and exits non-zero naming any it cannot see.
//
// Usage: node scripts/deprecate-broken-versions.mjs [--apply] [--otp <code>]
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = '@jadedm/nestjs-verify';
const MESSAGE =
  `Cannot be installed: its peer dependency on ${CORE} was published as an unresolved workspace range. ` +
  'Use the latest version.';

const usage = () => {
  console.error('usage: node scripts/deprecate-broken-versions.mjs [--apply] [--otp <code>]');
  process.exit(2);
};
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const otpAt = args.indexOf('--otp');
const otp = otpAt === -1 ? undefined : args[otpAt + 1];
const known = args.filter((a, i) => a === '--apply' || a === '--otp' || (otpAt !== -1 && i === otpAt + 1));
if (known.length !== args.length || (otpAt !== -1 && !otp)) usage();

const waitSeconds = Number(process.env.DEPRECATE_WAIT_SECONDS ?? 300);
const pollMs = Number(process.env.DEPRECATE_POLL_MS ?? 10_000);
if (!(waitSeconds >= 0 && pollMs > 0)) {
  console.error('deprecate-broken-versions: DEPRECATE_WAIT_SECONDS and DEPRECATE_POLL_MS must be numbers');
  process.exit(2);
}

const log = (line) => console.log(`deprecate-broken-versions: ${line}`);

// Any npm failure stops the script: a registry error must never read as
// "nothing to deprecate".
const npmJson = (...a) => {
  const out = execFileSync('npm', [...a, '--json', '--prefer-online'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return out ? JSON.parse(out) : undefined;
};

if (apply) {
  log('checking the npm login');
  let user;
  try {
    user = execFileSync('npm', ['whoami'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    // npm's own words: an expired login and an unreachable registry both land
    // here, and only the first is fixed by `npm login`.
    console.error(
      `deprecate-broken-versions: npm whoami failed, so npm is not signed in or not reachable. Nothing was changed.\n${String(err.stderr ?? '').trim()}\n` +
        'If it says E401, run `npm login`, then this command again.',
    );
    process.exit(1);
  }
  log(`signed in to npm as ${user}`);
}

const names = readdirSync(path.join(root, 'packages'))
  .map((dir) => JSON.parse(readFileSync(path.join(root, 'packages', dir, 'package.json'), 'utf8')))
  .filter((pkg) => !pkg.private)
  .map((pkg) => pkg.name);

// One npm view per version: its core peer and whether it is deprecated. The
// whole manifest, not named fields: asked for two fields of which only one
// exists, npm returns that one bare, and the peer map then reads as missing.
const versionInfo = (name, version) => {
  const manifest = npmJson('view', `${name}@${version}`);
  return { peer: manifest.peerDependencies?.[CORE], deprecated: manifest.deprecated };
};

log(`reading ${names.length} packages from npm (one request per version, this takes a minute)`);
const broken = names.flatMap((name) => {
  const all = [npmJson('view', name, 'versions')].flat();
  const found = all
    .map((version) => ({ name, version, ...versionInfo(name, version) }))
    .filter(({ peer }) => typeof peer === 'string' && peer.startsWith('workspace:'));
  const left = found.filter(({ deprecated }) => !deprecated).length;
  console.log(`  ${name}: ${all.length} version(s) on npm, ${found.length} broken, ${found.length - left} already deprecated, ${left} to do`);
  return found;
});
const todo = broken.filter(({ deprecated }) => !deprecated);

for (const { name, version } of broken.filter(({ deprecated }) => deprecated)) console.log(`done      ${name}@${version} (already deprecated)`);
for (const { name, version, peer } of todo) console.log(`${apply ? 'deprecate' : 'would deprecate'} ${name}@${version} (core peer ${peer})`);
if (todo.length === 0) {
  log(`nothing to do; ${broken.length} broken version(s), all deprecated`);
  process.exit(0);
}
if (!apply) {
  log(`${todo.length} to deprecate; rerun with --apply`);
  process.exit(0);
}

// One call per package. The range is the exact versions joined by `||`, and
// an exact version matches only itself, so no other version is touched.
const groups = [...new Set(todo.map(({ name }) => name))].map((name) => ({
  name,
  versions: todo.filter((t) => t.name === name).map(({ version }) => version),
}));
log(`${todo.length} version(s) in ${groups.length} package(s): ${groups.length} npm deprecate call(s), each needing one 2FA approval`);

const otpArgs = otp ? ['--otp', otp] : [];
const done = [];
for (const [i, { name, versions }] of groups.entries()) {
  const step = `[${i + 1}/${groups.length}]`;
  log(`${step} ${name} ${versions.join(', ')}${otp ? '' : ': approve in the browser when npm asks'}`);
  try {
    // inherit: npm prints its 2FA approval link to this terminal.
    execFileSync('npm', ['deprecate', `${name}@${versions.join(' || ')}`, MESSAGE, ...otpArgs], { cwd: root, stdio: 'inherit' });
  } catch {
    const left = groups.slice(i).flatMap(({ name: n, versions: vs }) => vs.map((v) => `${n}@${v}`));
    console.error(
      `deprecate-broken-versions: ${step} npm deprecate failed for ${name}.\n` +
        `Deprecated in this run: ${done.length ? done.join(', ') : 'none'}\nLeft: ${left.join(', ')}\n` +
        'Rerun; versions already deprecated are skipped.',
    );
    process.exit(1);
  }
  done.push(...versions.map((v) => `${name}@${v}`));
  log(`${step} ${name}: npm accepted ${versions.length} version(s)`);
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const notShown = () => todo.filter(({ name, version }) => !versionInfo(name, version).deprecated);
const deadline = Date.now() + waitSeconds * 1000;
log(`reading ${todo.length} version(s) back from npm`);
let missing = notShown();
for (let attempt = 2; missing.length > 0 && Date.now() < deadline; attempt += 1) {
  log(`npm shows ${todo.length - missing.length} of ${todo.length} as deprecated; waiting ${pollMs / 1000}s (read ${attempt})`);
  sleep(pollMs);
  missing = notShown();
}
for (const { name, version } of todo) {
  const shown = !missing.some((m) => m.name === name && m.version === version);
  console.log(`  ${name}@${version}: ${shown ? 'deprecated' : 'NOT SHOWN'}`);
}
if (missing.length > 0) {
  console.error(
    `deprecate-broken-versions: npm does not show these as deprecated after ${waitSeconds}s:\n- ` +
      missing.map(({ name, version }) => `${name}@${version}`).join('\n- '),
  );
  process.exit(1);
}
log(`${done.length} deprecated in ${groups.length} call(s) and read back`);
