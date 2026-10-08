import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { runMigrations } from './migration-runner.js';
import { MIGRATIONS } from './migrations.js';

const LATEST = Math.max(...MIGRATIONS.map((m) => m.version));

/**
 * A pool whose one client answers from a script. `fail` maps a statement
 * matcher to the error that statement throws; `version` is what
 * verify_schema_versions holds. `released` records what release() was given
 * and how many error listeners were still attached at that moment. A
 * statement matched by `socketError` behaves like pg on a dead socket: the
 * client emits 'error' and the query rejects with the same error. pg emits
 * from a socket callback, where an 'error' with no listener is an uncaught
 * exception; emitting inside this async fake would only reject the promise,
 * so the fake records `unhandledSocketErrors` instead of emitting then.
 */
const scripted = (opts: { fail?: [RegExp, Error][]; version?: number; socketError?: [RegExp, Error] }) => {
  const statements: string[] = [];
  const released: unknown[] = [];
  const listenersAtRelease: number[] = [];
  const crash = { unhandledSocketErrors: 0 };
  const client = new EventEmitter();
  let lost = false;
  const query = async (text: string) => {
    statements.push(text.trim());
    const dead = opts.socketError && opts.socketError[0].test(text) ? opts.socketError[1] : undefined;
    // After a socket error pg refuses every further query on that client.
    if (lost) throw new Error('Client has encountered a connection error and is not queryable');
    if (dead && client.listenerCount('error') === 0) crash.unhandledSocketErrors += 1;
    if (dead && client.listenerCount('error') > 0) client.emit('error', dead);
    if (dead) lost = true;
    if (dead) throw dead;
    const failure = opts.fail?.find(([pattern]) => pattern.test(text));
    if (failure) throw failure[1];
    const rows = /SELECT version FROM/.test(text) && opts.version !== undefined ? [{ version: opts.version }] : [];
    return { rows, rowCount: rows.length };
  };
  Object.assign(client, {
    query,
    release: (arg?: unknown) => {
      listenersAtRelease.push(client.listenerCount('error'));
      released.push(arg);
    },
  });
  const pool = { connect: async () => client, query } as unknown as Pool;
  return { pool, statements, released, listenersAtRelease, crash };
};

const rejection = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e as Error & { cause?: unknown },
  );

// The first migration's own SQL, so a matcher can fail exactly that statement.
const FIRST = MIGRATIONS[0]!;
const firstMigration = new RegExp(FIRST.sql.trim().slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const kept = (released: unknown[]) => expect(released).toEqual([false]);
const discarded = (released: unknown[]) => expect(released).toEqual([true]);

describe('runMigrations cleanup (#69)', () => {
  it('reports a failed migration and releases the client normally (case 1)', async () => {
    const cause = new Error('syntax error');
    const db = scripted({ fail: [[firstMigration, cause]] });
    const err = await rejection(runMigrations(db.pool));
    expect(err?.message).toBe(`Migration ${FIRST.version} (${FIRST.description}) failed: syntax error`);
    expect(err?.cause).toBe(cause);
    expect(db.statements).toContain('ROLLBACK');
    kept(db.released);
  });

  it('keeps the migration error when ROLLBACK fails, and discards the client (case 2)', async () => {
    const cause = new Error('syntax error');
    const db = scripted({ fail: [[firstMigration, cause], [/^ROLLBACK/, new Error('connection lost')]] });
    const err = await rejection(runMigrations(db.pool));
    expect(err?.message).toMatch(/^Migration \d+ .* failed: syntax error; ROLLBACK also failed: connection lost$/);
    expect(err?.cause).toBe(cause);
    discarded(db.released);
  });

  it('reports a failed unlock after a clean run, and discards the client (case 3)', async () => {
    const unlock = new Error('unlock failed');
    const db = scripted({ fail: [[/pg_advisory_unlock/, unlock]] });
    const err = await rejection(runMigrations(db.pool));
    expect(err).toBe(unlock);
    discarded(db.released);
  });

  it('reports the migration error, not the unlock error, when both fail (case 4)', async () => {
    const db = scripted({
      fail: [[firstMigration, new Error('syntax error')], [/pg_advisory_unlock/, new Error('unlock failed')]],
    });
    const err = await rejection(runMigrations(db.pool));
    expect(err?.message).toMatch(/failed: syntax error$/);
    discarded(db.released);
  });

  it('refuses a newer database, unlocks, and releases normally (case 5)', async () => {
    const db = scripted({ version: LATEST + 1 });
    const err = await rejection(runMigrations(db.pool));
    expect(err?.message).toMatch(/newer than this library expects/);
    expect(db.statements.some((s) => s.includes('pg_advisory_unlock'))).toBe(true);
    kept(db.released);
  });

  it('discards the client when the lock cannot be taken (case 6)', async () => {
    const lock = new Error('lock timeout');
    const db = scripted({ fail: [[/pg_advisory_lock\(/, lock]] });
    const err = await rejection(runMigrations(db.pool));
    expect(err).toBe(lock);
    expect(db.statements.some((s) => s.includes('pg_advisory_unlock'))).toBe(false);
    discarded(db.released);
  });

  it('applies every migration, unlocks and releases normally (case 7)', async () => {
    const db = scripted({});
    await runMigrations(db.pool);
    expect(db.statements.filter((s) => s === 'COMMIT')).toHaveLength(MIGRATIONS.length);
    expect(db.statements.at(-1)).toMatch(/pg_advisory_unlock/);
    kept(db.released);
    expect(db.listenersAtRelease).toEqual([0]);
  });

  it('survives a socket error with no other listener, and discards the client (case 8)', async () => {
    const reset = Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' });
    const db = scripted({ socketError: [/pg_advisory_lock\(/, reset] });
    const err = await rejection(runMigrations(db.pool));
    expect(err).toBe(reset);
    expect(db.crash.unhandledSocketErrors).toBe(0);
    discarded(db.released);
    expect(db.listenersAtRelease).toEqual([0]);
  });

  it('keeps the migration error when the connection drops mid-migration, and discards the client (case 8b)', async () => {
    const reset = Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' });
    const db = scripted({ socketError: [firstMigration, reset] });
    const err = await rejection(runMigrations(db.pool));
    expect(err?.message).toMatch(/failed: Connection terminated unexpectedly; ROLLBACK also failed: .*not queryable$/);
    expect(err?.cause).toBe(reset);
    expect(db.crash.unhandledSocketErrors).toBe(0);
    discarded(db.released);
  });

  it('reports a failed COMMIT as that migration failing, and rolls back (case 9)', async () => {
    const db = scripted({ fail: [[/^COMMIT/, new Error('could not serialize')]] });
    const err = await rejection(runMigrations(db.pool));
    expect(err?.message).toBe(`Migration ${FIRST.version} (${FIRST.description}) failed: could not serialize`);
    expect(db.statements).toContain('ROLLBACK');
    kept(db.released);
  });

  it('reports a failed BEGIN as that migration failing (case 10)', async () => {
    const db = scripted({ fail: [[/^BEGIN/, new Error('out of memory')]] });
    const err = await rejection(runMigrations(db.pool));
    expect(err?.message).toBe(`Migration ${FIRST.version} (${FIRST.description}) failed: out of memory`);
    expect(db.statements).not.toContain('COMMIT');
  });
});

describe('runMigrations with skipSchemaSetup (#69)', () => {
  it('reports a version mismatch when the table is missing (case 11)', async () => {
    const missing = Object.assign(new Error('relation "verify_schema_versions" does not exist'), { code: '42P01' });
    const db = scripted({ fail: [[/SELECT version FROM/, missing]] });
    const err = await rejection(runMigrations(db.pool, { skipSchemaSetup: true }));
    expect(err?.message).toMatch(/database is at 0, library expects/);
  });

  it('reports a connection or auth error as itself, not as version 0 (case 12)', async () => {
    const auth = Object.assign(new Error('password authentication failed'), { code: '28P01' });
    const db = scripted({ fail: [[/SELECT version FROM/, auth]] });
    const err = await rejection(runMigrations(db.pool, { skipSchemaSetup: true }));
    expect(err).toBe(auth);
  });

  it('passes when the database is current (case 13)', async () => {
    const db = scripted({ version: LATEST });
    await expect(runMigrations(db.pool, { skipSchemaSetup: true })).resolves.toBeUndefined();
  });
});
