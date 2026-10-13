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
// With --apply it runs `npm deprecate` once per version, so npm asks for 2FA
// in this terminal (a browser approval, or --otp <code> passed through). It
// stops at the first failure, naming what is done and what is left; a rerun
// skips the versions already deprecated. It then reads every version back,
// waiting up to DEPRECATE_WAIT_SECONDS (default 300) for npm to show the
// deprecation, and exits non-zero naming any it cannot see.
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

// Any npm failure stops the script: a registry error must never read as
// "nothing to deprecate".
const npmJson = (...a) => {
  const out = execFileSync('npm', [...a, '--json', '--prefer-online'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return out ? JSON.parse(out) : undefined;
};

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

const broken = names.flatMap((name) =>
  [npmJson('view', name, 'versions')]
    .flat()
    .map((version) => ({ name, version, ...versionInfo(name, version) }))
    .filter(({ peer }) => typeof peer === 'string' && peer.startsWith('workspace:')),
);
const todo = broken.filter(({ deprecated }) => !deprecated);

for (const { name, version } of broken.filter(({ deprecated }) => deprecated)) console.log(`done      ${name}@${version} (already deprecated)`);
for (const { name, version, peer } of todo) console.log(`${apply ? 'deprecate' : 'would deprecate'} ${name}@${version} (core peer ${peer})`);
if (todo.length === 0) {
  console.log(`deprecate-broken-versions: nothing to do; ${broken.length} broken version(s), all deprecated`);
  process.exit(0);
}
if (!apply) {
  console.log(`deprecate-broken-versions: ${todo.length} to deprecate; rerun with --apply`);
  process.exit(0);
}

const otpArgs = otp ? ['--otp', otp] : [];
const done = [];
for (const { name, version } of todo) {
  try {
    // inherit: npm prints its 2FA approval link to this terminal.
    execFileSync('npm', ['deprecate', `${name}@${version}`, MESSAGE, ...otpArgs], { cwd: root, stdio: 'inherit' });
  } catch {
    const left = todo.slice(done.length).map(({ name: n, version: v }) => `${n}@${v}`);
    console.error(
      `deprecate-broken-versions: npm deprecate failed for ${name}@${version}.\n` +
        `Deprecated in this run: ${done.length ? done.join(', ') : 'none'}\nLeft: ${left.join(', ')}\n` +
        'Rerun; versions already deprecated are skipped.',
    );
    process.exit(1);
  }
  done.push(`${name}@${version}`);
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const notShown = () => todo.filter(({ name, version }) => !versionInfo(name, version).deprecated);
const deadline = Date.now() + waitSeconds * 1000;
let missing = notShown();
while (missing.length > 0 && Date.now() < deadline) {
  console.log(`deprecate-broken-versions: waiting for npm to show ${missing.length} deprecation(s)`);
  sleep(pollMs);
  missing = notShown();
}
if (missing.length > 0) {
  console.error(
    `deprecate-broken-versions: npm does not show these as deprecated after ${waitSeconds}s:\n- ` +
      missing.map(({ name, version }) => `${name}@${version}`).join('\n- '),
  );
  process.exit(1);
}
console.log(`deprecate-broken-versions: ${done.length} deprecated and read back`);
