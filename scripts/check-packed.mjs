#!/usr/bin/env node
/**
 * Installs the packed packages into a clean project outside the workspace, as
 * a consumer would, and checks each one there. check-exports.mjs resolves
 * dependencies from the workspace, so it cannot see an old peer major, a
 * missing types file, or a dependency that is not declared (#23).
 *
 *   node scripts/check-packed.mjs --profile lowest    each peer's oldest supported major, newest release in it
 *   node scripts/check-packed.mjs --profile highest   each peer at the newest in its range
 *
 * `lowest` is the oldest major line, not the exact floor version: the floors
 * of several peers cannot be installed together (Nest 9.0.0 itself needs
 * rxjs ^7.1.0 while the core allows ^7.0.0), and a user on an old major runs
 * its latest release.
 *
 * Per package:
 * - every bare import or require in the built files names a declared peer,
 *   dependency or Node built-in (all packages share one node_modules here, so
 *   loading alone cannot tell one package's peer from another's);
 * - import() and require() by name both load, with and without optional peers;
 * - the ESM and CommonJS builds export the same names;
 * - the `types` files in `exports` and the top-level main and types files
 *   exist.
 * Then strict tsc (skipLibCheck off) over imports of every package three
 * ways: nodenext CommonJS, nodenext ESM (the .d.mts side), and node10, which
 * reads the top-level `types` field the way older setups do.
 *
 * A package whose engines.node excludes the running Node is skipped and said
 * so. Run after `pnpm build`. Exits non-zero on any failure.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const STEP_TIMEOUT_MS = 2 * 60_000;
const LOAD_TIMEOUT_MS = 30_000;
const OWN_SCOPE = '@jadedm/';
const LOAD_ERROR = 'check-packed-load-error:';

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
// Whether a resolved version is inside a single ^x.y.z range (caret rules,
// including the 0.x case where the minor is fixed).
const inCaret = (version, caret) => {
  const [want, got] = [parseVersion(caret.slice(1)), parseVersion(version)];
  if (got[0] !== want[0] || compare(got, want) < 0) return false;
  return want[0] !== 0 || got[1] === want[1];
};
const ENGINE = /^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
const nodeAllowed = (range) => {
  const m = ENGINE.exec(range.trim());
  if (!m) throw new Error(`unsupported engines.node "${range}" (expected >=N)`);
  const want = [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
  return compare(parseVersion(process.versions.node), want) >= 0;
};

const run = (cmd, args, opts) =>
  spawnSync(cmd, args, { encoding: 'utf8', killSignal: 'SIGKILL', timeout: STEP_TIMEOUT_MS, ...opts });
const tail = (r, n = 15) => `${r.error?.code ?? ''} ${r.stderr || ''}${r.stdout || ''}`.trim().split('\n').slice(-n).join('\n');

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
const withSkip = manifests.map((m) => ({ ...m, skip: skipReason(m) }));
for (const m of withSkip.filter((m) => m.skip)) console.log(`SKIP  ${m.pkg.name} (${m.skip})`);
const checked = withSkip.filter((m) => !m.skip);
if (checked.length === 0) {
  console.error('check-packed: no packages to check');
  process.exit(1);
}

// --- peers to install, one range per name
const peers = new Map();
const optionalPeers = new Set();
const peerSpecsOf = () => {
  for (const { pkg } of checked) {
    for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
      if (name.startsWith(OWN_SCOPE)) continue;
      const seen = peers.get(name);
      if (seen !== undefined && seen !== range) throw new Error(`${name} has two peer ranges: "${seen}" and "${range}"`);
      peers.set(name, range);
      if (pkg.peerDependenciesMeta?.[name]?.optional) optionalPeers.add(name);
    }
  }
  return new Map([...peers].map(([name, range]) => [name, profile === 'lowest' ? oldestMajor(range) : range]));
};
let wanted;
try {
  wanted = peerSpecsOf();
} catch (err) {
  console.error(`check-packed: ${err.message}`);
  process.exit(1);
}
const nodeMajor = process.versions.node.split('.')[0];
const toolSpecs = ['typescript@5', `@types/node@${nodeMajor}`, 'esbuild@0.24'];

// --- static dependency check: bare specifiers in the built files
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
const SPECIFIER = /\brequire\(\s*["']([^"']+)["']\s*\)|\bfrom\s*["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']/g;
const packageOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
const undeclaredImports = (installedDir, manifest, files) => {
  const declared = new Set([
    manifest.name,
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
  const found = new Set();
  for (const file of files) {
    const source = readFileSync(join(installedDir, file), 'utf8');
    for (const m of source.matchAll(SPECIFIER)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith('.') || spec.startsWith('/') || BUILTINS.has(spec)) continue;
      if (!declared.has(packageOf(spec))) found.add(packageOf(spec));
    }
  }
  return [...found];
};

// --- loading by name in the consumer project
const loadKeys = (projectDir, name, kind) => {
  const report = `catch (e) { process.stderr.write(${JSON.stringify(LOAD_ERROR)} + ' ' + (e && e.name ? e.name + ': ' + e.message : String(e)).split('\\n')[0] + '\\n'); process.exit(1); }`;
  const code = {
    esm: `try { const m = await import(${JSON.stringify(name)}); console.log(JSON.stringify(Object.keys(m).sort())) } ${report}`,
    cjs: `try { console.log(JSON.stringify(Object.keys(require(${JSON.stringify(name)})).sort())) } ${report}`,
  }[kind];
  const args = kind === 'esm' ? ['--input-type=module', '-e', code] : ['-e', code];
  const r = run(process.execPath, args, { cwd: projectDir, timeout: LOAD_TIMEOUT_MS });
  if (r.error) return { error: `${kind}: ${r.error.code ?? r.error.message}` };
  if (r.signal) return { error: `${kind}: killed by ${r.signal}` };
  if (r.status !== 0) {
    const line = r.stderr.split('\n').find((l) => l.startsWith(LOAD_ERROR));
    return { error: `${kind}: ${line ? line.slice(LOAD_ERROR.length).trim() : r.stderr.trim().split('\n').filter((l) => !/^Node\.js v/.test(l)).at(-1)}` };
  }
  return { keys: JSON.parse(r.stdout.trim().split('\n').at(-1)) };
};

// --- behaviour probes: things a package must do in a consumer's process that
// loading alone does not show. Each prints one word; `expect` maps the
// optional-peer state to that word.
const CORE = '@jadedm/nestjs-verify';
// kind: 'esm' (dynamic import), 'cjs' (require), 'module' (a static import,
// as an app file bundled by esbuild is written).
const metricsProbe = (kind) => {
  // 'registry' only when a started verification is really counted.
  const body = `const r = createMetricsRecorder({ enabled: true }); const reg = r.getRegistry(); if (!reg) { console.log('noop'); } else { r.startsTotal(); reg.metrics().then((t) => console.log(/verify_starts_total 1\\b/.test(t) ? 'registry' : 'registry-not-counting')); }`;
  if (kind === 'module') return `import { createMetricsRecorder } from '${CORE}';\n${body}`;
  const get = kind === 'esm' ? `(await import('${CORE}'))` : `require('${CORE}')`;
  return `const { createMetricsRecorder } = ${get}; ${body}`;
};
const PROBES = [
  // prom-client is an optional peer loaded with require(); ESM builds once
  // lost it silently (#48).
  { name: 'metrics recorder', pkg: CORE, code: metricsProbe, expect: { withOptional: 'registry', withoutOptional: 'noop' } },
];
// esbuild-cjs: the app bundled to CommonJS by esbuild with @jadedm/* inlined
// (their ESM builds, via the import condition) and every other package
// external, the usual serverless setup. It rewrites import.meta, which once
// crashed the core at load (#48).
const BUNDLE_SCRIPT = `require('esbuild').build({
  entryPoints: ['probe-app.mjs'], bundle: true, platform: 'node', format: 'cjs', outfile: 'probe-bundle.cjs', logLevel: 'error',
  plugins: [{ name: 'externals', setup(b) { b.onResolve({ filter: /^[^./]/ }, (a) => (a.path.startsWith('${OWN_SCOPE}') ? undefined : { path: a.path, external: true })); } }],
}).catch(() => process.exit(1));`;
const probeRun = (projectDir, probe, kind) => {
  if (kind === 'esm') return run(process.execPath, ['--input-type=module', '-e', probe.code('esm')], { cwd: projectDir, timeout: LOAD_TIMEOUT_MS });
  if (kind === 'cjs') return run(process.execPath, ['-e', probe.code('cjs')], { cwd: projectDir, timeout: LOAD_TIMEOUT_MS });
  writeFileSync(join(projectDir, 'probe-app.mjs'), probe.code('module'));
  writeFileSync(join(projectDir, 'probe-bundle-build.cjs'), BUNDLE_SCRIPT);
  const built = run(process.execPath, ['probe-bundle-build.cjs'], { cwd: projectDir });
  if (built.status !== 0) return built;
  return run(process.execPath, ['probe-bundle.cjs'], { cwd: projectDir, timeout: LOAD_TIMEOUT_MS });
};
const runProbe = (projectDir, probe, kind, state) => {
  const r = probeRun(projectDir, probe, kind);
  const got = r.status === 0 ? r.stdout.trim().split('\n').at(-1) : `exit ${r.status ?? r.signal ?? r.error?.code}: ${tail(r, 3)}`;
  const want = probe.expect[state];
  if (got !== want) fail(`${probe.pkg} ${probe.name} (${kind}, ${state}): got ${got}, want ${want}`);
  console.log(`${got === want ? 'ok  ' : 'FAIL'}  ${probe.name} ${kind} ${state}: ${got}`);
};
const runProbes = (projectDir, state) => {
  const present = new Set(checked.map(({ pkg }) => pkg.name));
  for (const probe of PROBES.filter((p) => present.has(p.pkg))) {
    for (const kind of ['esm', 'cjs', 'esbuild-cjs']) runProbe(projectDir, probe, kind, state);
  }
};

const packDir = mkdtempSync(join(tmpdir(), 'nv-pack-'));
const projectDir = mkdtempSync(join(tmpdir(), 'nv-consumer-'));
try {
  // 1. pack, which rewrites workspace: ranges the way a publish does; the
  //    tarball path is the last line pnpm prints.
  const tarballs = checked.map(({ dir, pkg }) => {
    const packed = run('pnpm', ['pack', '--pack-destination', packDir], { cwd: dir });
    if (packed.status !== 0) throw new Error(`pnpm pack failed for ${pkg.name}: ${tail(packed)}`);
    const file = packed.stdout.trim().split('\n').at(-1).trim();
    if (!file.endsWith('.tgz') || !existsSync(file)) throw new Error(`pnpm pack for ${pkg.name} printed no tarball path: ${file}`);
    return file;
  });

  // 2. clean consumer project; engine-strict, so a peer release that drops
  //    this Node fails here instead of passing with a warning nobody reads.
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'nv-consumer', version: '1.0.0', private: true }));
  const peerSpecs = [...wanted].map(([name, spec]) => `${name}@${spec}`);
  console.log(`install (${profile}): ${peerSpecs.join(' ')}`);
  const installed = run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', '--engine-strict', ...tarballs, ...peerSpecs, ...toolSpecs], {
    cwd: projectDir,
    timeout: INSTALL_TIMEOUT_MS,
  });
  if (installed.status !== 0) throw new Error(`npm install failed:\n${tail(installed)}`);
  const versionOf = (name) => {
    const file = join(projectDir, 'node_modules', ...name.split('/'), 'package.json');
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).version : undefined;
  };
  const resolved = [...wanted.keys()].map((name) => [name, versionOf(name)]);
  const missing = resolved.filter(([, v]) => v === undefined).map(([n]) => n);
  if (missing.length) throw new Error(`peers not installed: ${missing.join(' ')}`);
  const offMajor = profile === 'lowest' ? resolved.filter(([n, v]) => !inCaret(v, wanted.get(n))) : [];
  if (offMajor.length) throw new Error(`npm installed outside the requested major: ${offMajor.map(([n, v]) => `${n}@${v} (wanted ${wanted.get(n)})`).join(' ')}`);
  console.log(`resolved: ${resolved.map(([n, v]) => `${n}@${v}`).join(' ')}`);

  // 3. per package, by name, in the clean project
  for (const { pkg } of checked) {
    const installedDir = join(projectDir, 'node_modules', ...pkg.name.split('/'));
    const manifest = JSON.parse(readFileSync(join(installedDir, 'package.json'), 'utf8'));
    const exp = manifest.exports?.['.'] ?? {};
    const problems = [];
    const esm = loadKeys(projectDir, pkg.name, 'esm');
    const cjs = loadKeys(projectDir, pkg.name, 'cjs');
    for (const r of [esm, cjs]) if (r.error) problems.push(r.error);
    const bothLoaded = esm.keys && cjs.keys;
    if (bothLoaded && JSON.stringify(esm.keys) !== JSON.stringify(cjs.keys)) {
      const onlyEsm = esm.keys.filter((k) => !cjs.keys.includes(k));
      const onlyCjs = cjs.keys.filter((k) => !esm.keys.includes(k));
      problems.push(`ESM and CJS exports differ (only ESM: ${onlyEsm.join(',') || '-'}; only CJS: ${onlyCjs.join(',') || '-'})`);
    }
    if (bothLoaded && esm.keys.length === 0) problems.push('loaded with no exports');
    const fileFields = [
      ['exports import types', exp.import?.types],
      ['exports require types', exp.require?.types],
      ['top-level types', manifest.types],
      ['main', manifest.main],
    ];
    for (const [field, file] of fileFields) {
      if (!file) problems.push(`${field} not set`);
      else if (!existsSync(join(installedDir, file))) problems.push(`${field} file ${file} missing from the tarball`);
    }
    const entryFiles = [...new Set([exp.import?.default, exp.require?.default, manifest.main, manifest.module].filter(Boolean))];
    const undeclared = undeclaredImports(installedDir, manifest, entryFiles.filter((f) => existsSync(join(installedDir, f))));
    if (undeclared.length) problems.push(`imports packages it does not declare: ${undeclared.join(', ')}`);
    if (problems.length > 0) fail(`${pkg.name}: ${problems.join('; ')}`);
    console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${pkg.name}@${pkg.version}${problems.length ? '' : ` (${esm.keys.length} exports)`}`);
  }

  runProbes(projectDir, 'withOptional');

  // 4. strict tsc three ways
  const imports = checked.map(({ pkg }, i) => `import * as m${i} from '${pkg.name}';\nvoid m${i};`).join('\n');
  for (const file of ['check.ts', 'check.mts']) writeFileSync(join(projectDir, file), `${imports}\nexport {};\n`);
  const tscConfigs = [
    ['nodenext', 'nodenext, CommonJS and ESM sides', { module: 'nodenext', moduleResolution: 'nodenext' }, ['check.ts', 'check.mts']],
    ['node10', 'node10, top-level types', { module: 'commonjs', moduleResolution: 'node10' }, ['check.ts']],
  ];
  for (const [name, label, resolution, files] of tscConfigs) {
    const config = join(projectDir, `tsconfig.${name}.json`);
    writeFileSync(
      config,
      JSON.stringify({
        compilerOptions: { strict: true, skipLibCheck: false, noEmit: true, target: 'ES2022', types: ['node'], ...resolution },
        files,
      }),
    );
    const tsc = run(process.execPath, [join(projectDir, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', config], {
      cwd: projectDir,
      timeout: 5 * 60_000,
    });
    if (tsc.status !== 0) fail(`tsc ${label} failed:\n${tail(tsc, 20)}`);
    else console.log(`ok    tsc strict, ${label}`);
  }

  // 5. load again with the optional peers removed. Their folders are deleted
  //    directly: npm uninstall keeps a package that an installed package
  //    still lists as a peer, which is not what a user without it has.
  if (optionalPeers.size > 0) {
    for (const name of optionalPeers) rmSync(join(projectDir, 'node_modules', ...name.split('/')), { recursive: true, force: true });
    const left = [...optionalPeers].filter((n) => versionOf(n) !== undefined);
    if (left.length) throw new Error(`optional peers still installed after uninstall: ${left.join(' ')}`);
    for (const { pkg } of checked) {
      const errors = ['esm', 'cjs'].map((kind) => loadKeys(projectDir, pkg.name, kind).error).filter(Boolean);
      if (errors.length) fail(`${pkg.name} without optional peers: ${errors.join('; ')}`);
      console.log(`${errors.length ? 'FAIL' : 'ok  '}  ${pkg.name} loads without ${[...optionalPeers].join(', ')}`);
    }
    runProbes(projectDir, 'withoutOptional');
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  rmSync(packDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
}

console.log(`check-packed (${profile}, node ${process.versions.node}): ${process.exitCode ? 'FAILED' : 'passed'}`);
