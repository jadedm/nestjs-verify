import type {
  ReserveResult,
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

// Why a reservation that matched nothing was refused. The decision was made
// atomically by the update; this only names it from a later read, on the
// same database clock rather than this process's, which may disagree with
// it (#105). The read is a moment later than the update, so a record spent
// just before its deadline can be named expired; that fails closed.
const refusedOutcome = (r: VerificationRecord, expired: boolean): ReserveResult['outcome'] => {
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

  /**
   * Given ttlSeconds, the deadline is $$NOW + ttl, on the server clock that
   * reserveAttempt and the TTL index judge it by, and is returned (#108).
   * Without it the record's own expiresAt is stored and nothing is returned.
   */
  async create(v: VerificationRecord, ttlSeconds?: number): Promise<Date | void> {
    // The document keeps the field's pre-0.9.0 name, `phone` (#8).
    const { sid, recipient, ...rest } = v;
    const doc = { ...rest, phone: recipient };
    if (ttlSeconds === undefined) {
      // The record keeps core's deadline, so nothing is returned.
      await this.col.insertOne({ _id: sid, ...doc });
      return;
    }
    // An update pipeline is the only write that can read $$NOW. Every stored
    // record has createdAt, so the filter matches none and the upsert inserts;
    // an existing sid fails on _id, as insertOne would. Values are $literal:
    // in a pipeline a string starting with $ (a valid email can) is a field path.
    const fields = Object.fromEntries(Object.entries(doc).map(([k, value]) => [k, { $literal: value }]));
    const result = await this.col.findOneAndUpdate(
      { _id: sid, createdAt: { $exists: false } },
      [{ $set: { ...fields, expiresAt: { $add: ['$$NOW', ttlSeconds * 1000] } } }],
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
    return result.value!.expiresAt;
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
  async reserveAttempt(sid: string): Promise<ReserveResult> {
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
    const { _id, phone, ...rest } = doc;
    return { sid: _id, ...rest, recipient: phone };
  }
}
