#!/usr/bin/env node
/**
 * Installs the packed packages into a clean project outside the workspace, as
 * a consumer would, and checks each one there. check-exports.mjs resolves
 * dependencies from the workspace, so it cannot see an undeclared dependency,
 * the low end of a peer range, or a missing types file (#23).
 *
 *   node scripts/check-packed.mjs --profile lowest    each peer's oldest supported major, newest release in it
 *   node scripts/check-packed.mjs --profile highest   each peer at the newest in its range
 *
 * `lowest` is the oldest major line, not the exact floor version: the floors
 * of several peers cannot be installed together (Nest 9.0.0 itself needs
 * rxjs ^7.1.0 while the core allows ^7.0.0), and a user on an old major runs
 * its latest release.
 *
 * Per package: import() and require() by name both load, the ESM and CommonJS
 * builds export the same names, and every `types` file in `exports` exists.
 * Then one strict tsc pass (skipLibCheck off) over a file importing them all.
 * A package whose engines.node excludes the running Node is skipped and said
 * so. Run after `pnpm build`. Exits non-zero on any failure.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const LOAD_TIMEOUT_MS = 30_000;
const OWN_SCOPE = '@jadedm/';

const fail = (message) => {
  console.error(`check-packed: ${message}`);
  process.exitCode = 1;
};

const profileArg = process.argv.indexOf('--profile');
const profile = profileArg === -1 ? undefined : process.argv[profileArg + 1];
if (profile !== 'lowest' && profile !== 'highest') {
  console.error('usage: node scripts/check-packed.mjs --profile lowest|highest');
  process.exit(2);
}

// --- version helpers: only the range shapes this repo uses; anything else fails.
const parseVersion = (v) => v.split('.').map((n) => Number.parseInt(n, 10));
const compare = (a, b) => {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
};
const CARET = /^\^(\d+\.\d+\.\d+)$/;
// The lowest ^x.y.z alternative of a range, kept as a caret range: npm then
// installs the newest release of that oldest major line.
const oldestMajor = (range) => {
  const versions = range.split('||').map((alt) => CARET.exec(alt.trim())?.[1]);
  if (versions.some((v) => v === undefined)) throw new Error(`unsupported peer range "${range}" (expected ^x.y.z alternatives)`);
  return `^${versions.sort((a, b) => compare(parseVersion(a), parseVersion(b)))[0]}`;
};
const ENGINE = /^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
const nodeAllowed = (range) => {
  const m = ENGINE.exec(range.trim());
  if (!m) throw new Error(`unsupported engines.node "${range}" (expected >=N)`);
  const want = [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
  return compare(parseVersion(process.versions.node), want) >= 0;
};

const run = (cmd, args, opts) =>
  spawnSync(cmd, args, { encoding: 'utf8', killSignal: 'SIGKILL', ...opts });

// --- packages
const packagesDir = join(root, 'packages');
const manifests = readdirSync(packagesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(packagesDir, d.name, 'package.json')))
  .map((d) => ({ dir: join(packagesDir, d.name), pkg: JSON.parse(readFileSync(join(packagesDir, d.name, 'package.json'), 'utf8')) }))
  .filter(({ pkg }) => !pkg.private);

const skipReason = ({ pkg }) => {
  const engine = pkg.engines?.node;
  if (!engine || nodeAllowed(engine)) return null;
  return `engines.node ${engine}, running ${process.versions.node}`;
};
const skipped = manifests.map((m) => ({ ...m, skip: skipReason(m) }));
for (const m of skipped.filter((m) => m.skip)) console.log(`SKIP  ${m.pkg.name} (${m.skip})`);
const checked = skipped.filter((m) => !m.skip);
if (checked.length === 0) {
  console.error('check-packed: no packages to check');
  process.exit(1);
}

// --- peers to install, one range per name
const peers = new Map();
const peerSpecsOf = () => {
  for (const { pkg } of checked) {
    for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
      if (name.startsWith(OWN_SCOPE)) continue;
      const seen = peers.get(name);
      if (seen !== undefined && seen !== range) throw new Error(`${name} has two peer ranges: "${seen}" and "${range}"`);
      peers.set(name, range);
    }
  }
  return [...peers].map(([name, range]) => `${name}@${profile === 'lowest' ? oldestMajor(range) : range}`);
};
let peerSpecs;
try {
  peerSpecs = peerSpecsOf();
} catch (err) {
  console.error(`check-packed: ${err.message}`);
  process.exit(1);
}
const nodeMajor = process.versions.node.split('.')[0];
const toolSpecs = ['typescript@5', `@types/node@${nodeMajor}`, '@types/pg@8'];

const packDir = mkdtempSync(join(tmpdir(), 'nv-pack-'));
const projectDir = mkdtempSync(join(tmpdir(), 'nv-consumer-'));
try {
  // 1. pack, which rewrites workspace: ranges the way a publish does
  const tarballs = checked.map(({ dir, pkg }) => {
    const packed = run('pnpm', ['pack', '--pack-destination', packDir], { cwd: dir });
    if (packed.status !== 0) throw new Error(`pnpm pack failed for ${pkg.name}: ${packed.stderr || packed.stdout}`);
    const file = readdirSync(packDir).find((f) => f.endsWith(`-${pkg.version}.tgz`) && f.startsWith(pkg.name.replace('@', '').replace('/', '-')));
    if (!file) throw new Error(`no tarball found for ${pkg.name}@${pkg.version}`);
    return join(packDir, file);
  });

  // 2. clean consumer project
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'nv-consumer', version: '1.0.0', private: true }));
  console.log(`install (${profile}): ${peerSpecs.join(' ')}`);
  const installed = run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', ...tarballs, ...peerSpecs, ...toolSpecs], {
    cwd: projectDir,
    timeout: INSTALL_TIMEOUT_MS,
  });
  if (installed.status !== 0) throw new Error(`npm install failed:\n${(installed.stderr || installed.stdout).trim().split('\n').slice(-15).join('\n')}`);
  // Print what npm actually resolved, so a run shows which majors it covered.
  const resolved = [...peers.keys()].map((name) => {
    const file = join(projectDir, 'node_modules', ...name.split('/'), 'package.json');
    return `${name}@${existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).version : 'MISSING'}`;
  });
  if (resolved.some((r) => r.endsWith('@MISSING'))) throw new Error(`peers not installed: ${resolved.filter((r) => r.endsWith('@MISSING')).join(' ')}`);
  console.log(`resolved: ${resolved.join(' ')}`);

  // 3. per package, by name, in the clean project
  const keysOf = (name, kind) => {
    const code = {
      esm: `const m = await import(${JSON.stringify(name)}); console.log(JSON.stringify(Object.keys(m).sort()))`,
      cjs: `console.log(JSON.stringify(Object.keys(require(${JSON.stringify(name)})).sort()))`,
    }[kind];
    const args = kind === 'esm' ? ['--input-type=module', '-e', code] : ['-e', code];
    const r = run(process.execPath, args, { cwd: projectDir, timeout: LOAD_TIMEOUT_MS });
    if (r.error) return { error: `${kind}: ${r.error.code ?? r.error.message}` };
    if (r.status !== 0) return { error: `${kind}: ${r.stderr.trim().split('\n').find((l) => /Error/.test(l)) ?? r.stderr.trim().split('\n').at(-1)}` };
    return { keys: JSON.parse(r.stdout.trim().split('\n').at(-1)) };
  };

  for (const { pkg } of checked) {
    const installedDir = join(projectDir, 'node_modules', ...pkg.name.split('/'));
    const exp = JSON.parse(readFileSync(join(installedDir, 'package.json'), 'utf8')).exports?.['.'] ?? {};
    const problems = [];
    const esm = keysOf(pkg.name, 'esm');
    const cjs = keysOf(pkg.name, 'cjs');
    for (const r of [esm, cjs]) if (r.error) problems.push(r.error);
    const bothLoaded = esm.keys && cjs.keys;
    if (bothLoaded && JSON.stringify(esm.keys) !== JSON.stringify(cjs.keys)) {
      const onlyEsm = esm.keys.filter((k) => !cjs.keys.includes(k));
      const onlyCjs = cjs.keys.filter((k) => !esm.keys.includes(k));
      problems.push(`ESM and CJS exports differ (only ESM: ${onlyEsm.join(',') || '-'}; only CJS: ${onlyCjs.join(',') || '-'})`);
    }
    if (bothLoaded && esm.keys.length === 0) problems.push('loaded with no exports');
    for (const types of [exp.import?.types, exp.require?.types]) {
      if (!types) problems.push('exports["."] lacks a types entry');
      else if (!existsSync(join(installedDir, types))) problems.push(`types file ${types} missing from the tarball`);
    }
    if (problems.length > 0) fail(`${pkg.name}: ${problems.join('; ')}`);
    console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${pkg.name}@${pkg.version}${problems.length ? '' : ` (${esm.keys.length} exports)`}`);
  }

  // 4. one strict type-check over all of them
  const imports = checked.map(({ pkg }, i) => `import * as m${i} from '${pkg.name}';\nvoid m${i};`).join('\n');
  writeFileSync(join(projectDir, 'check.ts'), `${imports}\nexport {};\n`);
  writeFileSync(
    join(projectDir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        target: 'ES2022',
        module: 'nodenext',
        moduleResolution: 'nodenext',
        types: ['node'],
      },
      files: ['check.ts'],
    }),
  );
  const tsc = run(process.execPath, [join(projectDir, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', projectDir], {
    cwd: projectDir,
    timeout: 5 * 60_000,
  });
  if (tsc.status !== 0) fail(`tsc (strict, skipLibCheck off) failed:\n${(tsc.stdout + tsc.stderr).trim().split('\n').slice(0, 20).join('\n')}`);
  else console.log(`ok    tsc strict over ${checked.length} packages`);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  rmSync(packDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
}

console.log(`check-packed (${profile}, node ${process.versions.node}): ${process.exitCode ? 'FAILED' : 'passed'}`);
