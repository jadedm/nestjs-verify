#!/usr/bin/env node
// Fails if Changesets would release any package at 1.0.0 or above (#10).
//
// Each adapter declares core as a peer, bounded to the core minors it works
// with (`>=0.6.8 <0.7.0`). Changesets bumps a package at major when a release
// leaves its peer range, which in 0.x is 1.0.0, and the linked group then
// carries core, twilio, postgres and ses there with it. The PR that adds a
// core minor therefore widens the ranges of the adapters that work with it,
// and releases each of them so the widened range reaches npm.
//
// Two checks, both computed with the libraries @changesets/cli itself uses:
// - the pending changesets in .changeset/ as they are, which catches a core
//   minor whose adapter ranges were not widened, and a widened adapter that is
//   not released (npm would keep its old range and refuse the new core);
// - probe changesets that exist only in memory, which catch the config:
//   without onlyUpdatePeerDependentsWhenOutOfRange, every core minor bumps
//   every adapter at major even inside its range.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fromCli = createRequire(createRequire(import.meta.url).resolve('@changesets/cli/package.json'));
const assembleReleasePlan = fromCli('@changesets/assemble-release-plan').default;
const { read: readConfig } = fromCli('@changesets/config');
const readChangesets = fromCli('@changesets/read').default;
const { readPreState } = fromCli('@changesets/pre');
const { getPackages } = fromCli('@manypkg/get-packages');
const semver = fromCli('semver');

const CORE = '@jadedm/nestjs-verify';
const POSTGRES = '@jadedm/nestjs-verify-postgres';
const MONGO = '@jadedm/nestjs-verify-mongo';

const packages = await getPackages(root);
const config = await readConfig(root, packages);
const versionOf = (name) => packages.packages.find((p) => p.packageJson.name === name).packageJson.version;
// Prerelease mode (.changeset/pre.json) changes the plan; read it as the CLI does.
const preState = await readPreState(root);
const linkedWith = (name) => config.linked.find((group) => group.includes(name)) ?? [name];
const highest = (versions) => versions.reduce((a, b) => (semver.gt(b, a) ? b : a));

const planFor = (changesets, pkgs = packages) =>
  Object.fromEntries(
    assembleReleasePlan(changesets, pkgs, config, preState)
      .releases.filter((r) => r.type !== 'none')
      .map((r) => [r.name, r.newVersion]),
  );
const atOneOrAbove = (plan) => Object.keys(plan).filter((name) => semver.major(plan[name]) >= 1);
const show = (plan) => Object.entries(plan).map(([n, v]) => `${n.replace('@jadedm/', '')}@${v}`).join(', ') || '(nothing)';

// Adapters whose core peer range does not admit `coreVersion`.
const outOfRange = (coreVersion) =>
  packages.packages
    .filter((p) => p.packageJson.peerDependencies?.[CORE])
    .map((p) => ({ name: p.packageJson.name, range: p.packageJson.peerDependencies[CORE].replace(/^workspace:/, '') }))
    .filter(({ range }) => !semver.satisfies(coreVersion, range));

// The packages with every adapter's core range widened to admit `coreVersion`,
// as the PR preparing that minor would. Nothing is written to disk.
const widenedTo = (coreVersion) => {
  const upper = `${semver.major(coreVersion)}.${semver.minor(coreVersion) + 1}.0`;
  const clone = structuredClone(packages);
  for (const p of clone.packages) {
    const range = p.packageJson.peerDependencies?.[CORE];
    if (!range) continue;
    if (!/<\s*[\d.]+$/.test(range)) {
      throw new Error(`${p.packageJson.name}: core peer range "${range}" does not end in "<x.y.z"; the probes cannot widen it`);
    }
    p.packageJson.peerDependencies[CORE] = range.replace(/<\s*[\d.]+$/, `<${upper}`);
  }
  return clone;
};

const failures = [];

// 1. What the pending changesets would release.
const pending = await readChangesets(root);
const pendingPlan = planFor(pending);
const pendingTooHigh = atOneOrAbove(pendingPlan);
// When the cascade has already carried core to 1.0.0, name the 0.x minor the
// changesets asked for, which is the version the ranges need to admit.
const coreAsked = (v) => (v && semver.major(v) > semver.major(versionOf(CORE)) ? semver.inc(versionOf(CORE), 'minor') : v);
const coreNext = coreAsked(pendingPlan[CORE]);
const toWiden = coreNext ? outOfRange(coreNext) : [];
console.log(`${pendingTooHigh.length ? 'FAIL' : 'ok  '}  pending (${pending.length} changeset(s)): ${show(pendingPlan)}`);
if (pendingTooHigh.length > 0) {
  const hint = toWiden.length
    ? ` Core goes to ${coreNext}, outside the core peer range of: ${toWiden.map((a) => `${a.name} (${a.range})`).join(', ')}. Widen each range that works with core ${coreNext} and add a changeset for it.`
    : '';
  failures.push(`pending changesets plan ${pendingTooHigh.join(', ')} at 1.0.0 or above.${hint}`);
}

// Core's linked group shares one version line: releasing twilio, postgres or
// ses at a new minor without core puts core's next release on that minor too,
// outside the adapter ranges, and Changesets would then rewrite those ranges
// to an unbounded `>=`. So the version core takes now, or on its next patch,
// must stay inside every adapter's range.
const coreNextRelease =
  pendingPlan[CORE] ??
  semver.inc(highest(linkedWith(CORE).map((n) => pendingPlan[n] ?? versionOf(n))), 'patch');
const strandedBy = pendingTooHigh.length === 0 ? outOfRange(coreNextRelease) : [];
if (strandedBy.length > 0) {
  const via = pendingPlan[CORE] ? '' : ` (its next patch, after ${linkedWith(CORE).filter((n) => pendingPlan[n]).join(', ')} release)`;
  console.log(`FAIL  pending: core ${coreNextRelease}${via} is outside the range of ${strandedBy.map((a) => a.name).join(', ')}`);
  failures.push(`core would release as ${coreNextRelease}${via}, outside the core peer range of ${strandedBy.map((a) => `${a.name} (${a.range})`).join(', ')}. Release core in the same change and widen those ranges, or keep the linked package on a patch.`);
}

// A core release into a new minor needs every adapter that admits it released
// too: the adapter versions on npm still carry the previous range.
const newCoreMinor = pendingPlan[CORE] && semver.minor(pendingPlan[CORE]) !== semver.minor(versionOf(CORE)) && pendingTooHigh.length === 0;
const notReleased = newCoreMinor
  ? packages.packages
      .filter((p) => p.packageJson.peerDependencies?.[CORE] && !pendingPlan[p.packageJson.name])
      .filter((p) => semver.satisfies(pendingPlan[CORE], p.packageJson.peerDependencies[CORE].replace(/^workspace:/, '')))
      .map((p) => p.packageJson.name)
  : [];
if (notReleased.length > 0) {
  console.log(`FAIL  pending: core ${pendingPlan[CORE]} without releasing ${notReleased.join(', ')}`);
  failures.push(`core goes to ${pendingPlan[CORE]} but ${notReleased.join(', ')} admit it and have no pending changeset; their versions on npm still exclude it. Add a changeset for each.`);
}

// 2. Probes: what a core release does to the adapters, given the config.
const probe = (name, releases, pkgs, expect) => {
  const changeset = { id: 'release-plan-probe', summary: name, releases: Object.entries(releases).map(([n, type]) => ({ name: n, type })) };
  const plan = planFor([changeset], pkgs);
  const same = JSON.stringify(Object.keys(plan).sort()) === JSON.stringify([...expect].sort());
  const tooHigh = atOneOrAbove(plan);
  console.log(`${same && tooHigh.length === 0 ? 'ok  ' : 'FAIL'}  probe ${name}: ${show(plan)}`);
  if (tooHigh.length > 0) failures.push(`probe ${name}: plans ${tooHigh.join(', ')} at 1.0.0 or above`);
  if (!same) failures.push(`probe ${name}: expected releases of ${[...expect].join(', ')}, planned ${show(plan)}`);
};
// Core's next minor follows the highest version in its linked group.
const nextMinor = semver.inc(highest(linkedWith(CORE).map(versionOf)), 'minor');
probe('core patch', { [CORE]: 'patch' }, packages, [CORE]);
probe('core minor, adapter ranges widened', { [CORE]: 'minor' }, widenedTo(nextMinor), [CORE]);
probe('core minor + postgres minor, ranges widened', { [CORE]: 'minor', [POSTGRES]: 'minor' }, widenedTo(nextMinor), [CORE, POSTGRES]);
probe('mongo minor alone', { [MONGO]: 'minor' }, packages, [MONGO]);

if (failures.length > 0) {
  console.error(`\ncheck-release-plan: ${failures.length} problem(s)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('check-release-plan: passed');
