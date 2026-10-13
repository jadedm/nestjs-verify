import type { AbuseStore, SendAttempt } from '@jadedm/nestjs-verify';
import { Collection, Db, MongoClient, MongoClientOptions } from 'mongodb';

export interface MongoAbuseStoreOptions {
  uri?: string;
  clientOptions?: MongoClientOptions;
  databaseName?: string;
  db?: Db;
  collectionName?: string;
  /** TTL for abuse log retention, in seconds. Default 7 days. */
  retentionSeconds?: number;
}

// The recipient is stored as `phone`, the field name since 0.1 (#8).
interface SendAttemptDoc extends Omit<SendAttempt, 'ts' | 'recipient'> {
  phone: string;
  ts: Date;
}

export class MongoAbuseStore implements AbuseStore {
  private readonly col: Collection<SendAttemptDoc>;
  private readonly ownedClient?: MongoClient;
  private readonly retentionSeconds: number;

  constructor(opts: MongoAbuseStoreOptions) {
    let db: Db;
    if (opts.db) {
      db = opts.db;
    } else if (opts.uri) {
      const client = new MongoClient(opts.uri, opts.clientOptions);
      this.ownedClient = client;
      db = client.db(opts.databaseName);
    } else {
      throw new Error(
        'MongoAbuseStore: provide either { uri, databaseName? } or { db }',
      );
    }
    this.col = db.collection<SendAttemptDoc>(
      opts.collectionName ?? 'verify_abuse_log',
    );
    this.retentionSeconds = opts.retentionSeconds ?? 60 * 60 * 24 * 7;
  }

  async ensureIndexes(): Promise<void> {
    if (this.ownedClient) await this.ownedClient.connect();
    await Promise.all([
      this.col.createIndex(
        { ts: 1 },
        { expireAfterSeconds: this.retentionSeconds },
      ),
      this.col.createIndex({ ip: 1, ts: -1 }),
      this.col.createIndex({ phone: 1, ts: -1 }),
    ]);
  }

  async recordSendAttempt(s: SendAttempt): Promise<void> {
    // The document keeps the field's pre-0.9.0 name, `phone` (#8).
    const { recipient, ...rest } = s;
    await this.col.insertOne({ ...rest, phone: recipient, ts: s.ts ?? new Date() });
  }

  async countAttemptsByIp(ip: string, windowMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - windowMs);
    return this.col.countDocuments({ ip, ts: { $gt: cutoff } });
  }

  async countAttemptsByRecipient(
    recipient: string,
    windowMs: number,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - windowMs);
    return this.col.countDocuments({ phone: recipient, ts: { $gt: cutoff } });
  }

  async countDistinctRecipientsByIp(
    ip: string,
    windowMs: number,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - windowMs);
    const phones = await this.col.distinct('phone', {
      ip,
      ts: { $gt: cutoff },
    });
    return phones.length;
  }

  async close(): Promise<void> {
    await this.ownedClient?.close();
  }
}
