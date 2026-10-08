import type { CooldownStore } from '@jadedm/nestjs-verify';
import { Collection, Db, MongoClient, MongoClientOptions } from 'mongodb';

const settle = <T>(p: Promise<T>): Promise<[T, null] | [null, unknown]> =>
  p.then(
    (v): [T, null] => [v, null],
    (e: unknown): [null, unknown] => [null, e],
  );

export interface MongoCooldownStoreOptions {
  uri?: string;
  clientOptions?: MongoClientOptions;
  databaseName?: string;
  db?: Db;
  collectionName?: string;
}

interface CooldownDoc {
  _id: string;
  expiresAt: Date;
  /** Set by `claim`, removed by `start`. */
  holder?: string;
}

// MongoDB's duplicate key error code.
const DUPLICATE_KEY = 11000;

export class MongoCooldownStore implements CooldownStore {
  private readonly col: Collection<CooldownDoc>;
  private readonly ownedClient?: MongoClient;

  constructor(opts: MongoCooldownStoreOptions) {
    let db: Db;
    if (opts.db) {
      db = opts.db;
    } else if (opts.uri) {
      const client = new MongoClient(opts.uri, opts.clientOptions);
      this.ownedClient = client;
      db = client.db(opts.databaseName);
    } else {
      throw new Error(
        'MongoCooldownStore: provide either { uri, databaseName? } or { db }',
      );
    }
    this.col = db.collection<CooldownDoc>(
      opts.collectionName ?? 'verify_cooldowns',
    );
  }

  async remaining(key: string): Promise<number> {
    const doc = await this.col.findOne({ _id: key });
    if (!doc) return 0;
    const ms = doc.expiresAt.getTime() - Date.now();
    return Math.max(0, ms);
  }

  /** Uses the server's clock, as `claim` does, so the two agree on expiry. */
  async start(key: string, seconds: number): Promise<void> {
    await this.col.updateOne(
      { _id: key },
      [{ $set: { expiresAt: { $add: ['$$NOW', seconds * 1000] } } }, { $unset: 'holder' }],
      { upsert: true },
    );
  }

  /**
   * One update decides the holder, judged by the server's clock ($$NOW). The
   * pipeline rewrites the document only when it is missing, expired, or held
   * by `holder`, and otherwise leaves it as it was; the document it returns
   * says who holds the key. (A filter on $$NOW would need $expr, which an
   * upsert does not accept.) Two upserts racing to create the key can make
   * one fail with a duplicate key, which means the other won. The holder goes
   * through $literal so a value starting with "$" is not read as a field path.
   */
  async claim(key: string, seconds: number, holder: string): Promise<number> {
    const mine = { $literal: holder };
    const free = { $or: [{ $lte: ['$expiresAt', '$$NOW'] }, { $eq: ['$holder', mine] }] };
    const [res, err] = await settle(
      this.col.findOneAndUpdate(
        { _id: key },
        [
          {
            $set: {
              expiresAt: { $cond: [free, { $add: ['$$NOW', seconds * 1000] }, '$expiresAt'] },
              holder: { $cond: [free, mine, '$holder'] },
            },
          },
        ],
        { upsert: true, returnDocument: 'after', includeResultMetadata: true },
      ),
    );
    if (err !== null && (err as { code?: unknown }).code !== DUPLICATE_KEY) throw err;
    const doc = res?.value;
    if (doc?.holder === holder) return 0;
    if (doc) return Math.max(1, doc.expiresAt.getTime() - Date.now());
    return Math.max(1, await this.remaining(key));
  }

  async release(key: string, holder: string): Promise<void> {
    await this.col.deleteOne({ _id: key, holder });
  }

  async close(): Promise<void> {
    await this.ownedClient?.close();
  }
}
