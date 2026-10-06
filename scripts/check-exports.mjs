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
// A load error is caught in the child and printed after MARKER, so the report
// names the error itself rather than whatever else reached stderr.
const MARKER = 'check-exports-load-error:';
const describe = `const describe = (e) => e instanceof Error ? e.name + ': ' + e.message : (typeof e === 'string' ? e : JSON.stringify(e) ?? String(e));`;
const fail = `process.stderr.write(${JSON.stringify(MARKER)} + ' ' + describe(e).split('\\n')[0] + '\\n'); process.exit(1);`;
const loaders = {
  esm: (name) => ['--input-type=module', '-e', `${describe} try { const m = await import(${JSON.stringify(name)}); console.log(Object.keys(m).length) } catch (e) { ${fail} }`],
  cjs: (name) => ['-e', `${describe} try { console.log(Object.keys(require(${JSON.stringify(name)})).length) } catch (e) { ${fail} }`],
};
const LOAD_TIMEOUT_MS = 30_000;

// An error thrown after load is not caught by the loader; Node then prints the
// source line, a caret, the error, and a closing "Node.js vX" banner.
const errorFrom = (stderr) => {
  const lines = stderr.split('\n').map((l) => l.trim()).filter((l) => l && !/^Node\.js v/.test(l));
  const marked = lines.find((l) => l.startsWith(MARKER));
  if (marked) return marked.slice(MARKER.length).trim();
  return lines.findLast((l) => /^(Uncaught )?\w*(Error|Exception)\b.*:/.test(l)) ?? lines.at(-1) ?? '(no error output)';
};

const exportCount = (stdout) => Number(stdout.trim().split('\n').at(-1));

const check = (dir, kind, name, entry) => {
  if (!entry) return `${kind}: no exports["."].${kind === 'esm' ? 'import' : 'require'}.default`;
  if (!existsSync(join(dir, entry))) return `${kind}: ${entry} missing (not built?)`;
  const run = spawnSync(process.execPath, loaders[kind](name), {
    cwd: dir,
    encoding: 'utf8',
    timeout: LOAD_TIMEOUT_MS,
    // SIGTERM can be caught by the module under test; SIGKILL cannot.
    killSignal: 'SIGKILL',
  });
  if (run.error?.code === 'ETIMEDOUT') return `${kind}: load did not finish within ${LOAD_TIMEOUT_MS} ms`;
  if (run.error) return `${kind}: could not run the load (${run.error.code ?? run.error.message})`;
  if (run.signal) return `${kind}: load killed by ${run.signal}`;
  if (run.status !== 0) return `${kind}: ${errorFrom(run.stderr ?? '')}`;
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
