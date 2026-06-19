import type { AuditEvent, AuditSink } from '@jadedm/nestjs-verify';
import { Collection, Db, MongoClient, MongoClientOptions } from 'mongodb';

export interface MongoAuditSinkOptions {
  uri?: string;
  clientOptions?: MongoClientOptions;
  databaseName?: string;
  db?: Db;
  collectionName?: string;
}

interface AuditDoc extends Omit<AuditEvent, 'ts'> {
  ts: Date;
}

export class MongoAuditSink implements AuditSink {
  private readonly col: Collection<AuditDoc>;
  private readonly ownedClient?: MongoClient;

  constructor(opts: MongoAuditSinkOptions) {
    let db: Db;
    if (opts.db) {
      db = opts.db;
    } else if (opts.uri) {
      const client = new MongoClient(opts.uri, opts.clientOptions);
      this.ownedClient = client;
      db = client.db(opts.databaseName);
    } else {
      throw new Error(
        'MongoAuditSink: provide either { uri, databaseName? } or { db }',
      );
    }
    this.col = db.collection<AuditDoc>(
      opts.collectionName ?? 'verify_audit_log',
    );
  }

  async record(event: AuditEvent): Promise<void> {
    await this.col.insertOne({
      ...event,
      ts: event.ts,
    });
  }

  async close(): Promise<void> {
    await this.ownedClient?.close();
  }
}
