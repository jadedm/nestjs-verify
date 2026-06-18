import type {
  IncrementResult,
  VerificationRecord,
  VerificationStatus,
  VerifyStore,
} from '@jadedm/nestjs-verify';
import {
  Collection,
  Db,
  MongoClient,
  MongoClientOptions,
} from 'mongodb';

export interface MongoVerifyStoreOptions {
  /** Connection string. Required unless `db` is provided. */
  uri?: string;
  /** Mongo client options when constructing from `uri`. */
  clientOptions?: MongoClientOptions;
  /** Database name when constructing from `uri`. */
  databaseName?: string;
  /** Pre-built Db (e.g. from your own MongoClient or a Mongoose connection). */
  db?: Db;
  collectionName?: string;
}

interface VerificationDoc {
  _id: string;
  phone: string;
  channel: VerificationRecord['channel'];
  codeHash: string;
  salt: string;
  attempts: number;
  maxAttempts: number;
  status: VerificationStatus;
  createdAt: Date;
  expiresAt: Date;
}

export class MongoVerifyStore implements VerifyStore {
  private readonly col: Collection<VerificationDoc>;
  private readonly ownedClient?: MongoClient;

  constructor(opts: MongoVerifyStoreOptions) {
    let db: Db;
    if (opts.db) {
      db = opts.db;
    } else if (opts.uri) {
      const client = new MongoClient(opts.uri, opts.clientOptions);
      this.ownedClient = client;
      db = client.db(opts.databaseName);
    } else {
      throw new Error(
        'MongoVerifyStore: provide either { uri, databaseName? } or { db }',
      );
    }
    this.col = db.collection<VerificationDoc>(
      opts.collectionName ?? 'verifications',
    );
  }

  /** Idempotent. Call once at module init. */
  async ensureIndexes(): Promise<void> {
    if (this.ownedClient) await this.ownedClient.connect();
    await Promise.all([
      this.col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.col.createIndex({ phone: 1, status: 1, createdAt: -1 }),
    ]);
  }

  async create(v: VerificationRecord): Promise<void> {
    const { sid, ...rest } = v;
    await this.col.insertOne({ _id: sid, ...rest });
  }

  async get(sid: string): Promise<VerificationRecord | null> {
    const doc = await this.col.findOne({ _id: sid });
    return doc ? this.toRecord(doc) : null;
  }

  async incrementAttempts(sid: string): Promise<IncrementResult> {
    // Atomic: increment AND conditionally flip status to 'canceled' if the
    // new count reaches max_attempts. Single round-trip via aggregation-
    // pipeline update (Mongo 4.2+), returning the post-update document.
    const updated = await this.col.findOneAndUpdate(
      { _id: sid, status: 'pending' },
      [
        { $set: { attempts: { $add: ['$attempts', 1] } } },
        {
          $set: {
            status: {
              $cond: [
                { $gte: ['$attempts', '$maxAttempts'] },
                'canceled',
                '$status',
              ],
            },
          },
        },
      ],
      { returnDocument: 'after' },
    );

    if (updated) {
      const record = this.toRecord(updated);
      return {
        record,
        outcome: record.status === 'canceled' ? 'locked-out' : 'incremented',
      };
    }
    // No match — either sid doesn't exist or status was no longer 'pending'.
    const existing = await this.col.findOne({ _id: sid });
    if (!existing) return { record: null, outcome: 'not-found' };
    return { record: this.toRecord(existing), outcome: 'not-pending' };
  }

  async markStatus(
    sid: string,
    status: Exclude<VerificationStatus, 'pending'>,
  ): Promise<boolean> {
    const res = await this.col.updateOne(
      { _id: sid, status: 'pending' },
      { $set: { status } },
    );
    return res.matchedCount === 1;
  }

  async delete(sid: string): Promise<void> {
    await this.col.deleteOne({ _id: sid });
  }

  /** Optional. Only call if this store owns its MongoClient (constructed from `uri`). */
  async close(): Promise<void> {
    await this.ownedClient?.close();
  }

  private toRecord(doc: VerificationDoc): VerificationRecord {
    const { _id, ...rest } = doc;
    return { sid: _id, ...rest };
  }
}
