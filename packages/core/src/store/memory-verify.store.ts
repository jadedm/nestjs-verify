import {
  IncrementResult,
  VerificationRecord,
  VerificationStatus,
  VerifyStore,
} from '../interfaces/verify-store.interface.js';

/**
 * Single-process in-memory store. Useful for dev/test only — data is lost on
 * restart, and atomicity holds only within the JS event loop. Do NOT use in
 * a multi-instance deployment.
 */
export class MemoryVerifyStore implements VerifyStore {
  private readonly records = new Map<string, VerificationRecord>();

  async create(v: VerificationRecord): Promise<void> {
    this.records.set(v.sid, { ...v });
  }

  async get(sid: string): Promise<VerificationRecord | null> {
    const r = this.records.get(sid);
    if (!r) return null;
    if (r.expiresAt.getTime() <= Date.now() && r.status === 'pending') {
      const expired: VerificationRecord = { ...r, status: 'expired' };
      this.records.set(sid, expired);
      return expired;
    }
    return { ...r };
  }

  async incrementAttempts(sid: string): Promise<IncrementResult> {
    const r = this.records.get(sid);
    if (!r) return { record: null, outcome: 'not-found' };
    if (r.status !== 'pending')
      return { record: { ...r }, outcome: 'not-pending' };
    const nextAttempts = r.attempts + 1;
    const lockedOut = nextAttempts >= r.maxAttempts;
    const updated: VerificationRecord = {
      ...r,
      attempts: nextAttempts,
      status: lockedOut ? 'canceled' : r.status,
    };
    this.records.set(sid, updated);
    return {
      record: { ...updated },
      outcome: lockedOut ? 'locked-out' : 'incremented',
    };
  }

  async markStatus(
    sid: string,
    status: Exclude<VerificationStatus, 'pending'>,
  ): Promise<boolean> {
    const r = this.records.get(sid);
    if (!r || r.status !== 'pending') return false;
    this.records.set(sid, { ...r, status });
    return true;
  }

  async delete(sid: string): Promise<void> {
    this.records.delete(sid);
  }
}
