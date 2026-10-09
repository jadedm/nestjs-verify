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

// The shape of core's ReserveResult, written out so this store's published
// types do not need a core that exports it (its peer range starts at 0.6.8).
type ReserveOutcome = {
  record: VerificationRecord | null;
  outcome: 'reserved' | 'exhausted' | 'expired' | 'not-pending' | 'not-found';
};

// Why a reservation that matched nothing was refused. The decision was made
// atomically by the update; this only names it from a later read. Expiry is
// judged by the database clock the update used, not this process's clock,
// which may disagree with it (#105).
const refusedOutcome = (r: VerificationRecord, expired: boolean): ReserveOutcome['outcome'] => {
  if (r.status !== 'pending') return 'not-pending';
  if (expired) return 'expired';
  return 'exhausted';
};

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

  /**
   * One findOneAndUpdate reserves the attempt: the filter matches only a
   * pending document below its maximum, so at most maxAttempts concurrent
   * reservations succeed. The status is never changed here. The result is
   * read as { value } under drivers 5 and 6 (#79).
   */
  async reserveAttempt(sid: string): Promise<ReserveOutcome> {
    const result = await this.col.findOneAndUpdate(
      {
        _id: sid,
        status: 'pending',
        $expr: { $and: [{ $lt: ['$attempts', '$maxAttempts'] }, { $gt: ['$expiresAt', '$$NOW'] }] },
      },
      { $inc: { attempts: 1 } },
      { returnDocument: 'after', includeResultMetadata: true },
    );
    if (result.value) return { record: this.toRecord(result.value), outcome: 'reserved' };
    const [existing] = await this.col
      .aggregate<VerificationDoc & { dbExpired: boolean }>([
        { $match: { _id: sid } },
        { $addFields: { dbExpired: { $lte: ['$expiresAt', '$$NOW'] } } },
      ])
      .toArray();
    if (!existing) return { record: null, outcome: 'not-found' };
    const { dbExpired: expired, ...doc } = existing;
    const record = this.toRecord(doc);
    return { record, outcome: refusedOutcome(record, expired) };
  }

  /** @deprecated The service uses `reserveAttempt`; kept for direct callers. */
  async incrementAttempts(sid: string): Promise<IncrementResult> {
    // Atomic: increment AND conditionally flip status to 'canceled' if the
    // new count reaches max_attempts. Single round-trip via aggregation-
    // pipeline update (Mongo 4.2+), returning the post-update document.
    // includeResultMetadata gives the same { value } shape under drivers 5
    // and 6; driver 5 returns it by default and 6 returns the bare document
    // (#79).
    const result = await this.col.findOneAndUpdate(
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
      { returnDocument: 'after', includeResultMetadata: true },
    );
    const updated = result.value;

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
