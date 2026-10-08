import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { createPostgresStores } from './create-postgres-stores.js';
import { MIGRATIONS } from './migrations.js';

const LATEST = Math.max(...MIGRATIONS.map((m) => m.version));

/**
 * A stand-in for pg.Client, passed through `poolConfig.Client`, so the pool
 * that createPostgresStores creates itself talks to a scripted database
 * instead of the network. `script.connect` is the connection error, if any;
 * `script.version` is what verify_schema_versions holds.
 */
const script: { connect?: Error; version?: number; ended: number } = { ended: 0 };
class FakeClient extends EventEmitter {
  connect(cb?: (err?: Error) => void) {
    const err = script.connect;
    if (cb) {
      setImmediate(() => cb(err));
      return undefined;
    }
    return err ? Promise.reject(err) : Promise.resolve();
  }
  query(text: string, values?: unknown, cb?: (err: Error | null, res?: unknown) => void) {
    const callback = typeof values === 'function' ? (values as typeof cb) : cb;
    const rows = /SELECT version FROM verify_schema_versions/.test(text) && script.version !== undefined ? [{ version: script.version }] : [];
    const res = { rows, rowCount: rows.length };
    if (callback) {
      setImmediate(() => callback(null, res));
      return undefined;
    }
    return Promise.resolve(res);
  }
  end(cb?: () => void) {
    script.ended += 1;
    if (cb) setImmediate(cb);
    return Promise.resolve();
  }
}
const ownPool = () => ({ poolConfig: { Client: FakeClient as unknown as never } });

const rejection = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e as Error,
  );

describe('createPostgresStores, pool ownership (#65)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    script.connect = undefined;
    script.version = undefined;
    script.ended = 0;
  });

  it('ends the pool it created when it cannot connect (case 1)', async () => {
    script.connect = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });
    const end = vi.spyOn(Pool.prototype, 'end');
    const err = await rejection(createPostgresStores(ownPool()));
    expect(err?.message).toBe('connect failed');
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('ends the pool it created when a connected client is refused as newer (case 1b)', async () => {
    script.version = LATEST + 1;
    const end = vi.spyOn(Pool.prototype, 'end');
    const err = await rejection(createPostgresStores(ownPool()));
    expect(err?.message).toMatch(/newer than this library expects/);
    expect(end).toHaveBeenCalledTimes(1);
    // The client that ran the migrations was handed back and then closed.
    expect(script.ended).toBe(1);
  });

  it("leaves the caller's pool alone when it cannot connect (case 2)", async () => {
    const callerPool = {
      connect: vi.fn(async () => {
        throw Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });
      }),
      end: vi.fn(async () => undefined),
    } as unknown as Pool;
    const err = await rejection(createPostgresStores({ pool: callerPool }));
    expect(err?.message).toBe('connect failed');
    expect(callerPool.end).not.toHaveBeenCalled();
  });

  it('reports the migration error when ending the pool also fails (case 3)', async () => {
    script.connect = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });
    vi.spyOn(Pool.prototype, 'end').mockRejectedValue(new Error('end failed'));
    const err = await rejection(createPostgresStores(ownPool()));
    expect(err?.message).toBe('connect failed');
  });

  it("leaves the caller's pool alone when the database is refused as newer (case 4)", async () => {
    const client = { query: vi.fn(async () => ({ rows: [{ version: LATEST + 1 }] })), release: vi.fn() };
    const callerPool = {
      connect: vi.fn(async () => client),
      end: vi.fn(async () => undefined),
    } as unknown as Pool;
    const err = await rejection(createPostgresStores({ pool: callerPool }));
    expect(err?.message).toMatch(/newer than this library expects/);
    expect(callerPool.end).not.toHaveBeenCalled();
  });

  it('keeps the pool it created open when startup succeeds (case 5)', async () => {
    script.version = LATEST;
    const end = vi.spyOn(Pool.prototype, 'end');
    const stores = await createPostgresStores(ownPool());
    expect(end).not.toHaveBeenCalled();
    expect(stores.pool.ended).toBe(false);
    await stores.pool.end();
  });
});
