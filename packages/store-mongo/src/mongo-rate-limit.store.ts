import type {
  RateLimitHit,
  RateLimitStore,
} from '@jadedm/nestjs-verify';
import { Collection, Db, MongoClient, MongoClientOptions } from 'mongodb';

export interface MongoRateLimitStoreOptions {
  uri?: string;
  clientOptions?: MongoClientOptions;
  databaseName?: string;
  db?: Db;
  collectionName?: string;
}

interface RateLimitDoc {
  _id: string;
  count: number;
  resetAt: Date;
}

export class MongoRateLimitStore implements RateLimitStore {
  private readonly col: Collection<RateLimitDoc>;
  private readonly ownedClient?: MongoClient;

  constructor(opts: MongoRateLimitStoreOptions) {
    let db: Db;
    if (opts.db) {
      db = opts.db;
    } else if (opts.uri) {
      const client = new MongoClient(opts.uri, opts.clientOptions);
      this.ownedClient = client;
      db = client.db(opts.databaseName);
    } else {
      throw new Error(
        'MongoRateLimitStore: provide either { uri, databaseName? } or { db }',
      );
    }
    this.col = db.collection<RateLimitDoc>(
      opts.collectionName ?? 'verify_rate_limits',
    );
  }

  async hit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitHit> {
    // Atomic via findOneAndUpdate + aggregation pipeline. The pipeline
    // handles three cases in one expression: insert (no doc), reset
    // (resetAt elapsed), increment (within window).
    const windowMs = windowSeconds * 1000;
    const updated = await this.col.findOneAndUpdate(
      { _id: key },
      [
        {
          $set: {
            count: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $type: '$resetAt' }, 'missing'] },
                    { $lte: ['$resetAt', '$$NOW'] },
                  ],
                },
                1,
                { $add: ['$count', 1] },
              ],
            },
            resetAt: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $type: '$resetAt' }, 'missing'] },
                    { $lte: ['$resetAt', '$$NOW'] },
                  ],
                },
                { $add: ['$$NOW', windowMs] },
                '$resetAt',
              ],
            },
          },
        },
      ],
      { upsert: true, returnDocument: 'after' },
    );
    return {
      count: updated!.count,
      limit,
      exceeded: updated!.count > limit,
      resetAt: updated!.resetAt.getTime(),
    };
  }

  async close(): Promise<void> {
    await this.ownedClient?.close();
  }
}
