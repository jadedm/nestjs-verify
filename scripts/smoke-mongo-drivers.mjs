#!/usr/bin/env node
// Runs the Mongo part of the adapter smoke once per `mongodb` driver version
// the store's peer range accepts (#79). The workspace installs only driver 6, so a store that works
// under 6 and breaks under 5, which `@jadedm/nestjs-verify-mongo` also
// accepts, would otherwise pass CI.
//
// For each version: pack core and store-mongo from this checkout (run
// `pnpm build` first), install the tarballs into a clean temp project beside
// that mongodb version and core's peers, confirm what was installed, and run
// scripts/smoke-adapters.mjs there with SMOKE_BACKENDS=mongo. A major ("5")
// installs its newest release; an exact version ("5.0.0") installs exactly
// that. 5.0.0 is the lowest the peer range accepts and predates the
// `includeResultMetadata` option the stores pass (added in 5.7).
// Expects the smoke Mongo (scripts/docker-compose.smoke.yml) to be up.
//
// Usage: node scripts/smoke-mongo-drivers.mjs [versions, default "5.0.0,5,6"]
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versions = (process.argv[2] ?? '5.0.0,5,6').split(',').map((v) => v.trim());
const isExact = (v) => /^\d+\.\d+\.\d+$/.test(v);
// "5" must install some 5.x; "5.0.0" must install exactly 5.0.0.
const satisfies = (wanted, installed) =>
  isExact(wanted) ? installed === wanted : installed.split('.')[0] === wanted;

// Core's required peers, at versions known to install together on Node 18+.
const PEERS = [
  '@nestjs/common@^10',
  '@nestjs/core@^10',
  '@nestjs/swagger@^8',
  '@opentelemetry/api@^1.9.0',
  'class-transformer@^0.5.1',
  'class-validator@^0.14.1',
  'reflect-metadata@^0.2.0',
  'rxjs@^7',
];

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

const work = mkdtempSync(path.join(tmpdir(), 'verify-mongo-drivers-'));
let failed = 0;
try {
  const tarballs = path.join(work, 'tgz');
  for (const pkg of ['core', 'store-mongo']) {
    run('pnpm', ['pack', '--pack-destination', tarballs], { cwd: path.join(root, 'packages', pkg), stdio: 'ignore' });
  }
  const tgz = readdirSync(tarballs).map((f) => path.join(tarballs, f));
  if (tgz.length !== 2) throw new Error(`expected 2 tarballs, found ${tgz.length}: ${tgz.join(', ')}`);

  for (const wanted of versions) {
    console.log(`\n##### mongodb driver ${wanted} #####`);
    const project = path.join(work, `driver-${wanted}`);
    run('mkdir', ['-p', project]);
    run('npm', ['init', '-y'], { cwd: project, stdio: 'ignore' });
    run('npm', ['install', '--no-audit', '--no-fund', ...tgz, isExact(wanted) ? `mongodb@${wanted}` : `mongodb@^${wanted}`, ...PEERS], { cwd: project, stdio: 'ignore' });
    // The driver the store itself loads, not merely the top-level copy.
    const fromStore = createRequire(path.join(project, 'node_modules', '@jadedm', 'nestjs-verify-mongo', 'package.json'));
    const installed = JSON.parse(readFileSync(fromStore.resolve('mongodb/package.json'), 'utf8')).version;
    if (!satisfies(wanted, installed)) {
      throw new Error(`asked for mongodb ${wanted}, installed ${installed}`);
    }
    console.log(`installed mongodb ${installed}`);
    copyFileSync(path.join(root, 'scripts', 'smoke-adapters.mjs'), path.join(project, 'smoke-adapters.mjs'));
    try {
      run('node', ['smoke-adapters.mjs'], {
        cwd: project,
        env: { ...process.env, SMOKE_BACKENDS: 'mongo', SMOKE_MG_DB: `verify_smoke_driver${wanted.replaceAll('.', '_')}_${Date.now().toString(36)}` },
      });
    } catch {
      failed += 1;
      console.error(`FAIL: Mongo smoke under mongodb ${installed}`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`\nsmoke-mongo-drivers: ${failed} of ${versions.length} driver(s) failed`);
  process.exit(1);
}
console.log(`\nsmoke-mongo-drivers: passed on mongodb ${versions.join(', ')}`);
