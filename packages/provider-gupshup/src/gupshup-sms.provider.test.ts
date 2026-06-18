import { describe, expect, it, vi } from 'vitest';
import {
  GupshupSmsProvider,
  GupshupTerminalError,
  GupshupTransientError,
  parseGupshupResponse,
} from './gupshup-sms.provider.js';

function mockFetch(
  responses: Array<{ status?: number; body?: string; throws?: Error }>,
): { fn: typeof fetch; calls: URL[] } {
  const calls: URL[] = [];
  let i = 0;
  const fn = (async (input: any) => {
    calls.push(new URL(input.toString()));
    const r = responses[Math.min(i, responses.length - 1)]!;
    i++;
    if (r.throws) throw r.throws;
    return new Response(r.body ?? '', { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fn, calls };
}

describe('GupshupSmsProvider', () => {
  it('returns providerMessageId on success', async () => {
    const { fn } = mockFetch([
      { body: 'success | sent | 1709231830293-XYZ' },
    ]);
    const p = new GupshupSmsProvider({
      auth: { mode: 'apikey', apiKey: 'key' },
      sender: 'JADEDM',
      fetchImpl: fn,
    });
    const res = await p.send({ to: '+919999', body: 'Your code is 1' });
    expect(res).toEqual({
      providerMessageId: '1709231830293-XYZ',
      provider: 'gupshup',
    });
  });

  it('retries transient HTTP 503 and eventually succeeds', async () => {
    const { fn, calls } = mockFetch([
      { status: 503, body: 'down' },
      { status: 503, body: 'down' },
      { body: 'success | sent | OK_ID' },
    ]);
    const p = new GupshupSmsProvider({
      auth: { mode: 'apikey', apiKey: 'k' },
      sender: 'JADEDM',
      maxRetries: 2,
      retryBaseMs: 1,
      fetchImpl: fn,
    });
    const res = await p.send({ to: '+91', body: 'hi' });
    expect(res.providerMessageId).toBe('OK_ID');
    expect(calls).toHaveLength(3);
  });

  it('retries on network errors (treated as transient)', async () => {
    const { fn, calls } = mockFetch([
      { throws: new Error('ECONNREFUSED') },
      { body: 'success | sent | OK' },
    ]);
    const p = new GupshupSmsProvider({
      auth: { mode: 'apikey', apiKey: 'k' },
      sender: 'JADEDM',
      maxRetries: 2,
      retryBaseMs: 1,
      fetchImpl: fn,
    });
    const res = await p.send({ to: '+91', body: 'hi' });
    expect(res.providerMessageId).toBe('OK');
    expect(calls).toHaveLength(2);
  });

  it('does NOT retry terminal 4xx', async () => {
    const { fn, calls } = mockFetch([
      { status: 400, body: 'bad request' },
    ]);
    const p = new GupshupSmsProvider({
      auth: { mode: 'apikey', apiKey: 'k' },
      sender: 'JADEDM',
      maxRetries: 3,
      retryBaseMs: 1,
      fetchImpl: fn,
    });
    await expect(p.send({ to: '+91', body: 'hi' })).rejects.toBeInstanceOf(
      GupshupTerminalError,
    );
    expect(calls).toHaveLength(1);
  });

  it('treats in-body "error|..." response as terminal', async () => {
    const { fn, calls } = mockFetch([
      { body: 'error | invalidNumber | Phone is malformed' },
    ]);
    const p = new GupshupSmsProvider({
      auth: { mode: 'apikey', apiKey: 'k' },
      sender: 'JADEDM',
      maxRetries: 3,
      retryBaseMs: 1,
      fetchImpl: fn,
    });
    await expect(p.send({ to: '+91', body: 'hi' })).rejects.toBeInstanceOf(
      GupshupTerminalError,
    );
    expect(calls).toHaveLength(1);
  });

  it('gives up after exhausting retries on persistent transient errors', async () => {
    const { fn, calls } = mockFetch([
      { status: 503 },
      { status: 503 },
      { status: 503 },
    ]);
    const p = new GupshupSmsProvider({
      auth: { mode: 'apikey', apiKey: 'k' },
      sender: 'JADEDM',
      maxRetries: 2,
      retryBaseMs: 1,
      fetchImpl: fn,
    });
    await expect(p.send({ to: '+91', body: 'hi' })).rejects.toBeInstanceOf(
      GupshupTransientError,
    );
    expect(calls).toHaveLength(3);
  });

  it('AUTH_MAPPERS handle apikey mode', async () => {
    const { fn, calls } = mockFetch([{ body: 'success | sent | OK' }]);
    const p = new GupshupSmsProvider({
      auth: { mode: 'apikey', apiKey: 'my-key' },
      sender: 'JADEDM',
      fetchImpl: fn,
    });
    await p.send({ to: '+91', body: 'b' });
    expect(calls[0]!.searchParams.get('apikey')).toBe('my-key');
    expect(calls[0]!.searchParams.has('userid')).toBe(false);
  });

  it('AUTH_MAPPERS handle userpass mode', async () => {
    const { fn, calls } = mockFetch([{ body: 'success | sent | OK' }]);
    const p = new GupshupSmsProvider({
      auth: { mode: 'userpass', userid: 'u', password: 'p' },
      sender: 'JADEDM',
      fetchImpl: fn,
    });
    await p.send({ to: '+91', body: 'b' });
    expect(calls[0]!.searchParams.get('userid')).toBe('u');
    expect(calls[0]!.searchParams.get('password')).toBe('p');
    expect(calls[0]!.searchParams.has('apikey')).toBe(false);
  });

  it('strips leading + from send_to', async () => {
    const { fn, calls } = mockFetch([{ body: 'success | sent | OK' }]);
    const p = new GupshupSmsProvider({
      auth: { mode: 'apikey', apiKey: 'k' },
      sender: 'JADEDM',
      fetchImpl: fn,
    });
    await p.send({ to: '+919999999999', body: 'b' });
    expect(calls[0]!.searchParams.get('send_to')).toBe('919999999999');
  });

  it('parseGupshupResponse classifies known shapes', () => {
    expect(parseGupshupResponse('success | sent | M1').ok).toBe(true);
    expect(parseGupshupResponse('success | sent | M1').detail).toBe('M1');
    expect(parseGupshupResponse('error | foo | bar').ok).toBe(false);
    expect(parseGupshupResponse('error | foo | bar').detail).toBe('bar');
  });
});
