import type { RecipientIndexStore } from '@jadedm/nestjs-verify';
import { Collection, Db, MongoClient, MongoClientOptions } from 'mongodb';

export interface MongoRecipientIndexStoreOptions {
  uri?: string;
  clientOptions?: MongoClientOptions;
  databaseName?: string;
  db?: Db;
  collectionName?: string;
}

interface PhoneIndexDoc {
  _id: string;
  sid: string;
  expiresAt: Date;
  /** The record's createdAt; absent on entries written before 0.9.0 (#82). */
  createdAt?: Date;
}

export class MongoRecipientIndexStore implements RecipientIndexStore {
  private readonly col: Collection<PhoneIndexDoc>;
  private readonly ownedClient?: MongoClient;

  constructor(opts: MongoRecipientIndexStoreOptions) {
    let db: Db;
    if (opts.db) {
      db = opts.db;
    } else if (opts.uri) {
      const client = new MongoClient(opts.uri, opts.clientOptions);
      this.ownedClient = client;
      db = client.db(opts.databaseName);
    } else {
      throw new Error(
        'MongoRecipientIndexStore: provide either { uri, databaseName? } or { db }',
      );
    }
    this.col = db.collection<PhoneIndexDoc>(
      opts.collectionName ?? 'verify_phone_index',
    );
  }

  /**
   * One upsert on _id whose pipeline decides, against the stored document,
   * whether to replace it: only when it has expired by the server's clock,
   * has no createdAt, or is no newer than this write (#82). Otherwise the
   * stored fields are kept. Without createdAt it always
   * replaces. The server sets and judges the expiry, as its TTL monitor does
   * (#108). The filter is an equality on _id alone, so the server retries an
   * upsert that loses an insert race (MongoDB 4.2+), and $$NOW is read in the
   * pipeline, where it is allowed. Values are $literal: in a pipeline a string
   * starting with $ is a field path.
   */
  async set(phone: string, sid: string, ttlSeconds: number, createdAt?: Date): Promise<void> {
    const expiresAt = { $add: ['$$NOW', ttlSeconds * 1000] };
    if (!createdAt) {
      await this.col.updateOne({ _id: phone }, [{ $set: { sid: { $literal: sid }, expiresAt } }, { $unset: 'createdAt' }], {
        upsert: true,
      });
      return;
    }
    const replace = {
      $or: [
        { $eq: [{ $type: '$createdAt' }, 'missing'] },
        { $lte: ['$createdAt', { $literal: createdAt }] },
        { $lte: ['$expiresAt', '$$NOW'] },
      ],
    };
    await this.col.updateOne(
      { _id: phone },
      [
        { $set: { replace_: replace } },
        {
          $set: {
            sid: { $cond: ['$replace_', { $literal: sid }, '$sid'] },
            expiresAt: { $cond: ['$replace_', expiresAt, '$expiresAt'] },
            createdAt: { $cond: ['$replace_', { $literal: createdAt }, '$createdAt'] },
          },
        },
        { $unset: 'replace_' },
      ],
      { upsert: true },
    );
  }

  // Live by the server's clock, which set the expiry (#108).
  async get(phone: string): Promise<string | null> {
    const doc = await this.col.findOne({ _id: phone, $expr: { $gt: ['$expiresAt', '$$NOW'] } });
    return doc?.sid ?? null;
  }

  async delete(phone: string): Promise<void> {
    await this.col.deleteOne({ _id: phone });
  }

  async deleteIfMatches(phone: string, sid: string): Promise<void> {
    await this.col.deleteOne({ _id: phone, sid });
  }

  async close(): Promise<void> {
    await this.ownedClient?.close();
  }
}
