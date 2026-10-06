import { describe, expect, it, vi } from 'vitest';
import { TwilioSmsProvider } from './twilio-sms.provider.js';

/**
 * We don't talk to the real Twilio API — we monkey-patch the internal client
 * after construction to exercise the retry/terminal-error branches.
 */
function makeProvider(maxRetries = 2, retryBaseMs = 1) {
  const p = new TwilioSmsProvider({
    accountSid: 'ACxxxxx',
    authToken: 'token',
    from: '+15555555555',
    maxRetries,
    retryBaseMs,
  });
  return p;
}

function patchMessages(p: TwilioSmsProvider, create: (...a: any[]) => any) {
  (p as any).client = { messages: { create } };
  return p;
}

describe('TwilioSmsProvider', () => {
  it('returns providerMessageId on success', async () => {
    const p = patchMessages(makeProvider(), async () => ({ sid: 'SM123' }));
    const res = await p.send({ to: '+14155552671', body: 'hi' });
    expect(res).toEqual({ providerMessageId: 'SM123', provider: 'twilio' });
  });

  it('retries transient 429 and eventually succeeds', async () => {
    let calls = 0;
    const p = patchMessages(makeProvider(2), async () => {
      calls++;
      if (calls < 3) {
        const err: any = new Error('rate limited');
        err.status = 429;
        throw err;
      }
      return { sid: 'SM_OK' };
    });
    const res = await p.send({ to: '+1', body: 'x' });
    expect(res.providerMessageId).toBe('SM_OK');
    expect(calls).toBe(3);
  });

  it('does NOT retry terminal 4xx errors', async () => {
    let calls = 0;
    const p = patchMessages(makeProvider(3), async () => {
      calls++;
      const err: any = new Error('invalid number');
      err.status = 400;
      throw err;
    });
    await expect(p.send({ to: '+1', body: 'x' })).rejects.toThrow('invalid number');
    expect(calls).toBe(1);
  });

  it('gives up after exhausting retry budget on persistent transient errors', async () => {
    let calls = 0;
    const p = patchMessages(makeProvider(2), async () => {
      calls++;
      const err: any = new Error('upstream down');
      err.status = 503;
      throw err;
    });
    await expect(p.send({ to: '+1', body: 'x' })).rejects.toThrow('upstream down');
    expect(calls).toBe(3); // initial + 2 retries
  });

  it('uses messagingServiceSid when from starts with MG', async () => {
    const p = new TwilioSmsProvider({
      accountSid: 'AC',
      authToken: 't',
      from: 'MGabc123',
    });
    const seen: any[] = [];
    patchMessages(p, async (args: any) => {
      seen.push(args);
      return { sid: 'SM' };
    });
    await p.send({ to: '+1', body: 'b' });
    expect(seen[0]).toMatchObject({ messagingServiceSid: 'MGabc123' });
    expect(seen[0]).not.toHaveProperty('from');
  });
});

describe('TwilioSmsProvider, abort (case 16)', () => {
  it('stops retrying once the signal aborts, even mid-backoff', async () => {
    const create = vi.fn(async () => {
      throw Object.assign(new Error('service unavailable'), { status: 503 });
    });
    const p = patchMessages(makeProvider(5, 50), create);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('core gave up')), 10);
    const started = Date.now();
    await expect(p.send({ to: '+14155552671', body: 'hi' }, { signal: controller.signal })).rejects.toThrow('core gave up');
    expect(Date.now() - started).toBeLessThan(45);
    await new Promise((r) => setTimeout(r, 300));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not start when the signal is already aborted', async () => {
    const create = vi.fn(async () => ({ sid: 'SM1' }));
    const p = patchMessages(makeProvider(), create);
    await expect(p.send({ to: '+14155552671', body: 'hi' }, { signal: AbortSignal.abort(new Error('late')) })).rejects.toThrow('late');
    expect(create).not.toHaveBeenCalled();
  });
});
