import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { createPostgresStores } from './create-postgres-stores.js';

// Nothing listens on port 1, so connecting fails at once with ECONNREFUSED
// and the migrations never reach a database.
const UNREACHABLE = 'postgres://user:pass@127.0.0.1:1/none';

const rejection = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e as Error & { code?: string },
  );

describe('createPostgresStores, failed startup (#65)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ends the pool it created when migrations fail (case 1)', async () => {
    const end = vi.spyOn(Pool.prototype, 'end');
    const err = await rejection(createPostgresStores({ connectionString: UNREACHABLE }));
    expect(err?.code).toBe('ECONNREFUSED');
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("leaves the caller's pool alone (case 2)", async () => {
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
    vi.spyOn(Pool.prototype, 'end').mockRejectedValue(new Error('end failed'));
    const err = await rejection(createPostgresStores({ connectionString: UNREACHABLE }));
    expect(err?.code).toBe('ECONNREFUSED');
  });

  it("leaves the caller's pool alone when the database is refused as newer (case 4)", async () => {
    const client = { query: vi.fn(async () => ({ rows: [{ version: 999 }] })), release: vi.fn() };
    const callerPool = {
      connect: vi.fn(async () => client),
      query: vi.fn(async () => ({ rows: [{ version: 999 }] })),
      end: vi.fn(async () => undefined),
    } as unknown as Pool;
    const err = await rejection(createPostgresStores({ pool: callerPool }));
    // version 999 is newer than this package: a refusal, not a pool problem.
    expect(err).toBeDefined();
    expect(callerPool.end).not.toHaveBeenCalled();
  });
});
