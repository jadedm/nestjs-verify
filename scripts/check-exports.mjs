/**
 * Loads every package by name the way a consumer's Node does: import() and
 * require() of the package name, resolved through its `exports` map. Each load
 * runs in a child node started inside the package directory, which Node
 * resolves through the package's own `exports` (self-reference).
 * Unit tests run source through vitest's own interop and never load dist,
 * so an import that only breaks in plain Node (a named import from a
 * CommonJS dependency, for example) passes them. Run after `pnpm build`.
 *
 * Not covered: dependencies resolve from the workspace (the package's own
 * node_modules, dev dependencies included, and the root), so a dependency the
 * package forgot to declare still loads here. Only a packed tarball installed
 * into a clean project catches that. Loads run on the CI Node version only.
 *
 * Exits non-zero on any load failure, a load that hangs, a missing entry
 * file, or no packages.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(root, 'packages');

const entriesOf = (dir) => {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const main = pkg.exports?.['.'];
  return {
    name: pkg.name,
    esm: main?.import?.default,
    cjs: main?.require?.default,
  };
};

// Each prints the number of exports it got as its last stdout line. The child
// is left to exit on its own, so an error thrown after load still fails it; a
// module that keeps the process alive fails on the timeout instead of hanging.
const loaders = {
  esm: (name) => ['--input-type=module', '-e', `const m = await import(${JSON.stringify(name)}); console.log(Object.keys(m).length)`],
  cjs: (name) => ['-e', `console.log(Object.keys(require(${JSON.stringify(name)})).length)`],
};
const LOAD_TIMEOUT_MS = 30_000;

// Node prints the source line and a caret before the error itself.
const firstError = (stderr) =>
  stderr.split('\n').find((l) => /^\s*\w*(Error|Exception)\b.*:/.test(l))?.trim() ??
  stderr.trim().split('\n').at(-1);

const exportCount = (stdout) => Number(stdout.trim().split('\n').at(-1));

const check = (dir, kind, name, entry) => {
  if (!entry) return `${kind}: no exports["."].${kind === 'esm' ? 'import' : 'require'}.default`;
  if (!existsSync(join(dir, entry))) return `${kind}: ${entry} missing (not built?)`;
  const run = spawnSync(process.execPath, loaders[kind](name), {
    cwd: dir,
    encoding: 'utf8',
    timeout: LOAD_TIMEOUT_MS,
  });
  if (run.error?.code === 'ETIMEDOUT') return `${kind}: load did not finish within ${LOAD_TIMEOUT_MS} ms`;
  if (run.status !== 0) return `${kind}: ${firstError(run.stderr)}`;
  if (!(exportCount(run.stdout) > 0)) return `${kind}: loaded with no exports`;
  return null;
};

const dirs = readdirSync(packagesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(packagesDir, d.name, 'package.json')))
  .map((d) => join(packagesDir, d.name));

if (dirs.length === 0) {
  console.error(`check-exports: no packages found under ${packagesDir}`);
  process.exit(1);
}

let failures = 0;
let loads = 0;
for (const dir of dirs) {
  const entries = entriesOf(dir);
  for (const kind of ['esm', 'cjs']) {
    const problem = check(dir, kind, entries.name, entries[kind]);
    loads += 1;
    if (problem) failures += 1;
    console.log(`${problem ? 'FAIL' : 'ok  '}  ${entries.name} ${problem ?? kind}`);
  }
}

console.log(`check-exports: ${loads - failures}/${loads} loaded`);
process.exit(failures === 0 ? 0 : 1);
